// src/sqs/sqs-consumer.service.ts

import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  Message,
  ReceiveMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { SQS_CLIENT } from './sqs.constants';
import {
  AppQueueMessage,
  SyncChunkMessage,
  SyncMessage,
} from 'src/types/sqs-message';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStoreSyncRecord } from '../sync/dto/create-store-sync-record.dto';
import { Status, SyncStatus } from 'src/generated/prisma/enums';
import { MyHrSyncService } from '../myhr/myhr-sync.service';
import { getPositiveInteger } from '../myhr/myhr-sync.config';

type QueuedSyncRecord = {
  id: string;
  storesId: string;
};

type SyncInsertResult = {
  totalInserted: number;
  insertedCountBySyncRecord: Map<string, number>;
};

type LockedStoreSyncRecord = {
  id: string;
  status: SyncStatus;
};

@Injectable()
export class SqsProcessor
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(SqsProcessor.name);
  private readonly queueUrl: string;
  private readonly visibilityTimeoutSeconds: number;

  private running = false;
  private pollPromise: Promise<void> | null = null;
  private activeMyHrMessages = 0;
  private readonly myHrWaiters: Array<() => void> = [];
  private readonly myHrConcurrency: number;

  constructor(
    @Inject(SQS_CLIENT)
    private readonly sqsClient: SQSClient,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly myHrSyncService: MyHrSyncService,
  ) {
    this.queueUrl = this.configService.getOrThrow<string>('AWS_SQS_QUEUE_URL');
    this.visibilityTimeoutSeconds = this.getVisibilityTimeoutSeconds();
    this.myHrConcurrency = getPositiveInteger(
      this.configService,
      'MYHR_WORKER_CONCURRENCY',
      2,
    );
  }

  onApplicationBootstrap(): void {
    this.running = true;
    this.pollPromise = this.poll();
  }

  async onApplicationShutdown(): Promise<void> {
    this.running = false;
    await this.pollPromise;
  }

  private async poll(): Promise<void> {
    this.logger.log('SQS consumer started');

    while (this.running) {
      try {
        const response = await this.sqsClient.send(
          new ReceiveMessageCommand({
            QueueUrl: this.queueUrl,
            MaxNumberOfMessages: 10,
            WaitTimeSeconds: 20,
            VisibilityTimeout: this.visibilityTimeoutSeconds,
          }),
        );

        const messages = response.Messages ?? [];

        await Promise.all(
          messages.map((message) => this.processMessage(message)),
        );
      } catch (error) {
        this.logger.error(
          'Failed to poll SQS',
          error instanceof Error ? error.stack : String(error),
        );

        await this.delay(5000);
      }
    }
  }

  private async processMessage(message: Message): Promise<void> {
    const { Body, ReceiptHandle, MessageId } = message;

    if (!Body || !ReceiptHandle) {
      this.logger.warn(
        `Received an invalid SQS message: ${MessageId ?? 'unknown'}`,
      );
      return;
    }

    const heartbeat = setInterval(
      () => {
        void this.extendVisibility(ReceiptHandle, MessageId);
      },
      Math.max(1_000, Math.floor((this.visibilityTimeoutSeconds * 1_000) / 2)),
    );

    try {
      const parsed: unknown = JSON.parse(Body);

      if (!this.isAppQueueMessage(parsed)) {
        throw new Error('Invalid SQS message structure');
      }

      const shouldDelete = await this.handleMessage(parsed);
      if (!shouldDelete) return;

      await this.sqsClient.send(
        new DeleteMessageCommand({
          QueueUrl: this.queueUrl,
          ReceiptHandle,
        }),
      );

      this.logger.log(
        `Successfully processed message ${MessageId ?? 'unknown'}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to process message ${MessageId ?? 'unknown'}`,
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async handleMessage(message: AppQueueMessage): Promise<boolean> {
    switch (message.type) {
      case 'SYNC_RECORDS':
        await this.processSyncRecords(message.payload);
        return true;

      case 'SYNC_RECORD_CHUNK':
        await this.processSyncRecordChunk(message.payload);
        return true;

      case 'SYNC_MY_HR_CHUNK':
        if (!this.isMyHrWorkerEnabled()) return false;
        await this.withMyHrSlot(() =>
          this.myHrSyncService.processChunk(message.payload.chunkId),
        );
        return true;

      case 'START_MY_HR_SYNC':
        if (!this.isMyHrWorkerEnabled()) return false;
        await this.withMyHrSlot(() =>
          this.myHrSyncService.handleTrigger(message.payload),
        );
        return true;

      case 'CHECK_MY_HR_BATCH':
        if (!this.isMyHrWorkerEnabled()) return false;
        await this.withMyHrSlot(() =>
          this.myHrSyncService.checkBatch(
            message.payload.chunkId,
            message.payload.batchId,
          ),
        );
        return true;

      default: {
        const unsupportedMessage = message as {
          type?: unknown;
        };

        throw new Error(
          `Unsupported SQS message type: ${String(unsupportedMessage.type)}`,
        );
      }
    }
  }

  private delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, milliseconds);
    });
  }

  private async extendVisibility(
    receiptHandle: string,
    messageId: string | undefined,
  ): Promise<void> {
    try {
      await this.sqsClient.send(
        new ChangeMessageVisibilityCommand({
          QueueUrl: this.queueUrl,
          ReceiptHandle: receiptHandle,
          VisibilityTimeout: this.visibilityTimeoutSeconds,
        }),
      );
    } catch (error) {
      this.logger.warn(
        `Failed to extend visibility for message ${messageId ?? 'unknown'}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async withMyHrSlot<T>(operation: () => Promise<T>): Promise<T> {
    if (this.activeMyHrMessages >= this.myHrConcurrency) {
      await new Promise<void>((resolve) => this.myHrWaiters.push(resolve));
    }
    this.activeMyHrMessages += 1;
    try {
      return await operation();
    } finally {
      this.activeMyHrMessages -= 1;
      this.myHrWaiters.shift()?.();
    }
  }

  private getVisibilityTimeoutSeconds(): number {
    const configuredTimeout = Number(
      this.configService.get<string>('AWS_SQS_VISIBILITY_TIMEOUT_SECONDS'),
    );

    return Number.isFinite(configuredTimeout) && configuredTimeout > 0
      ? configuredTimeout
      : 300;
  }

  private isMyHrWorkerEnabled(): boolean {
    const enabled =
      this.configService.get<string>('MYHR_WORKER_ENABLED', 'false') === 'true';
    if (!enabled) {
      this.logger.warn('event=myhr_message_skipped reason=worker_disabled');
    }
    return enabled;
  }

  private async processSyncRecords(messagePayload: SyncMessage): Promise<void> {
    const { payload, syncRecords } = messagePayload;

    if (syncRecords.length === 0) {
      throw new Error('No sync records provided');
    }

    const syncRecordIds = syncRecords.map((record) => record.id);

    try {
      await this.prisma.storeSyncRecord.updateMany({
        where: {
          id: {
            in: syncRecordIds,
          },
        },
        data: {
          status: 'PROCESSING',
          startedAt: new Date(),
          completedAt: null,
          errorMessage: null,
        },
      });

      const result = await this.insertSyncPayload(payload, syncRecords);

      await this.prisma.$transaction(
        syncRecords.map((syncRecord) =>
          this.prisma.storeSyncRecord.update({
            where: {
              id: syncRecord.id,
            },
            data: {
              status: 'SUCCESS',
              completedAt: new Date(),
              errorMessage: null,
              insertedRecords:
                result.insertedCountBySyncRecord.get(syncRecord.id) ?? 0,
            },
          }),
        ),
      );

      this.logger.log(
        `Sync completed. Inserted ${result.totalInserted} attendance records.`,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Unknown error occurred while syncing records';

      await this.prisma.storeSyncRecord.updateMany({
        where: {
          id: {
            in: syncRecordIds,
          },
        },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          errorMessage,
        },
      });

      throw error;
    }
  }

  private async processSyncRecordChunk(
    messagePayload: SyncChunkMessage,
  ): Promise<void> {
    const chunk = await this.prisma.storeSyncRecordChunk.findUnique({
      where: {
        id: messagePayload.chunkId,
      },
      select: {
        id: true,
        status: true,
        totalRecords: true,
        payload: true,
        storeSyncRecordID: true,
        storeSyncRecord: {
          select: {
            id: true,
            storesId: true,
            store: {
              select: {
                name: true,
                status: true,
              },
            },
          },
        },
      },
    });

    if (!chunk) {
      throw new Error(`Sync chunk not found: ${messagePayload.chunkId}`);
    }

    if (chunk.status === SyncStatus.SUCCESS) {
      this.logger.log(`Sync chunk ${chunk.id} already processed.`);
      await this.finalizeStoreSyncRecord(chunk.storeSyncRecordID);
      return;
    }

    if (chunk.status === SyncStatus.FAILED) {
      this.logger.log(`Sync chunk ${chunk.id} already failed.`);
      await this.finalizeStoreSyncRecord(chunk.storeSyncRecordID);
      return;
    }

    if (chunk.status === SyncStatus.PROCESSING) {
      this.logger.log(`Sync chunk ${chunk.id} is already being processed.`);
      return;
    }

    const claimResult = await this.prisma.storeSyncRecordChunk.updateMany({
      where: {
        id: chunk.id,
        status: SyncStatus.PENDING,
      },
      data: {
        status: SyncStatus.PROCESSING,
        startedAt: new Date(),
        completedAt: null,
        errorMessage: null,
      },
    });

    if (claimResult.count === 0) {
      const currentChunk = await this.prisma.storeSyncRecordChunk.findUnique({
        where: {
          id: chunk.id,
        },
        select: {
          status: true,
          storeSyncRecordID: true,
        },
      });

      if (!currentChunk) {
        throw new Error(`Sync chunk not found: ${chunk.id}`);
      }

      if (
        currentChunk.status === SyncStatus.SUCCESS ||
        currentChunk.status === SyncStatus.FAILED
      ) {
        await this.finalizeStoreSyncRecord(currentChunk.storeSyncRecordID);
        return;
      }

      this.logger.log(`Sync chunk ${chunk.id} was claimed by another worker.`);
      return;
    }

    try {
      if (!this.isCreateStoreSyncRecord(chunk.payload)) {
        throw new Error(`Invalid sync chunk payload: ${chunk.id}`);
      }

      if (chunk.storeSyncRecord.store.status !== Status.active) {
        throw new Error(
          `Inactive store cannot sync: ${chunk.storeSyncRecord.store.name}`,
        );
      }

      await this.prisma.storeSyncRecord.updateMany({
        where: {
          id: chunk.storeSyncRecordID,
          status: {
            notIn: [SyncStatus.SUCCESS, SyncStatus.FAILED],
          },
        },
        data: {
          status: SyncStatus.PROCESSING,
          startedAt: new Date(),
          completedAt: null,
          errorMessage: null,
        },
      });

      const result = await this.insertSyncPayload(chunk.payload, [
        chunk.storeSyncRecord,
      ]);

      await this.prisma.storeSyncRecordChunk.update({
        where: {
          id: chunk.id,
        },
        data: {
          status: SyncStatus.SUCCESS,
          completedAt: new Date(),
          errorMessage: null,
          insertedRecords: result.totalInserted,
          failedRecords: 0,
        },
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Unknown error occurred while syncing chunk';

      await this.prisma.storeSyncRecordChunk.updateMany({
        where: {
          id: chunk.id,
          status: SyncStatus.PROCESSING,
        },
        data: {
          status: SyncStatus.FAILED,
          completedAt: new Date(),
          errorMessage,
          failedRecords: chunk.totalRecords,
        },
      });

      await this.finalizeStoreSyncRecord(chunk.storeSyncRecordID);

      throw error;
    }

    await this.finalizeStoreSyncRecord(chunk.storeSyncRecordID);

    this.logger.log(`Sync chunk ${chunk.id} completed.`);
  }

  private async insertSyncPayload(
    payload: CreateStoreSyncRecord,
    syncRecords: QueuedSyncRecord[],
  ): Promise<SyncInsertResult> {
    const deviceIds = [
      ...new Set(payload.sync_record.map((record) => record.device_id)),
    ];

    if (deviceIds.length === 0) {
      throw new Error('No devices provided');
    }

    const devices = await this.prisma.devices.findMany({
      where: {
        serialNumber: {
          in: deviceIds,
        },
      },
      select: {
        serialNumber: true,
        storesId: true,
        store: {
          select: {
            name: true,
            status: true,
          },
        },
      },
    });

    const deviceMap = new Map(
      devices.map((device) => [device.serialNumber, device]),
    );

    const missingDeviceIds = deviceIds.filter(
      (deviceId) => !deviceMap.has(deviceId),
    );

    if (missingDeviceIds.length > 0) {
      throw new Error(`Devices not found: ${missingDeviceIds.join(', ')}`);
    }

    const inactiveStoreNames = [
      ...new Set(
        devices
          .filter((device) => device.store.status !== Status.active)
          .map((device) => device.store.name),
      ),
    ];

    if (inactiveStoreNames.length > 0) {
      throw new Error(
        `Inactive stores cannot sync: ${inactiveStoreNames.join(', ')}`,
      );
    }

    const storeToSyncMap = new Map(
      syncRecords.map((syncRecord) => [syncRecord.storesId, syncRecord.id]),
    );

    const incomingAttendanceIds = [
      ...new Set(
        payload.sync_record.flatMap((record) =>
          record.attendance_record.map((log) => log.id),
        ),
      ),
    ];

    const existingAttendance =
      incomingAttendanceIds.length === 0
        ? []
        : await this.prisma.attendanceRecord.findMany({
            where: {
              id: {
                in: incomingAttendanceIds,
              },
            },
            select: {
              id: true,
            },
          });

    const processedAttendanceIds = new Set(
      existingAttendance.map((record) => record.id),
    );

    type AttendanceInsert = {
      id: string;
      employeeName: string;
      userId: string;
      logDate: Date;
      logType: number;
      storeSyncRecordID: string;
    };

    const CHUNK_SIZE = 500;

    let batch: AttendanceInsert[] = [];
    let totalInserted = 0;

    const insertedCountBySyncRecord = new Map<string, number>();

    const insertBatch = async (): Promise<void> => {
      if (batch.length === 0) {
        return;
      }

      const currentBatch = batch;
      batch = [];

      const created = await this.prisma.attendanceRecord.createMany({
        data: currentBatch,
        skipDuplicates: true,
      });

      totalInserted += created.count;

      if (syncRecords.length === 1) {
        const syncRecordId = syncRecords[0].id;
        insertedCountBySyncRecord.set(
          syncRecordId,
          (insertedCountBySyncRecord.get(syncRecordId) ?? 0) + created.count,
        );
        return;
      }

      /*
       * Exact per-sync counting is only guaranteed when no rows are skipped.
       * If duplicates may be inserted concurrently, createMany does not tell
       * us which exact rows were skipped.
       */
      if (created.count === currentBatch.length) {
        for (const item of currentBatch) {
          insertedCountBySyncRecord.set(
            item.storeSyncRecordID,
            (insertedCountBySyncRecord.get(item.storeSyncRecordID) ?? 0) + 1,
          );
        }
      }
    };

    for (const record of payload.sync_record) {
      const device = deviceMap.get(record.device_id);

      if (!device) {
        throw new Error(`Device not found: ${record.device_id}`);
      }

      const syncRecordId = storeToSyncMap.get(device.storesId);

      if (!syncRecordId) {
        throw new Error(`Sync record not found for store: ${device.storesId}`);
      }

      for (const log of record.attendance_record) {
        if (processedAttendanceIds.has(log.id)) {
          continue;
        }

        const logDate = this.parseLogDate(log.log_date);

        batch.push({
          id: log.id,
          employeeName: log.employee_name,
          userId: log.employee_id,
          logDate,
          logType: log.punch,
          storeSyncRecordID: syncRecordId,
        });

        processedAttendanceIds.add(log.id);

        if (batch.length >= CHUNK_SIZE) {
          await insertBatch();
        }
      }
    }

    await insertBatch();

    return {
      totalInserted,
      insertedCountBySyncRecord,
    };
  }

  private async finalizeStoreSyncRecord(
    storeSyncRecordID: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const lockedRecords = await tx.$queryRaw<LockedStoreSyncRecord[]>`
        SELECT id, status
        FROM "StoreSyncRecord"
        WHERE id = ${storeSyncRecordID}
        FOR UPDATE
      `;

      const lockedRecord = lockedRecords[0];

      if (!lockedRecord) {
        throw new Error(`Store sync record not found: ${storeSyncRecordID}`);
      }

      const [failedChunk, incompleteChunks, aggregate] = await Promise.all([
        tx.storeSyncRecordChunk.findFirst({
          where: {
            storeSyncRecordID,
            status: SyncStatus.FAILED,
          },
          select: {
            errorMessage: true,
          },
        }),
        tx.storeSyncRecordChunk.count({
          where: {
            storeSyncRecordID,
            status: {
              in: [SyncStatus.PENDING, SyncStatus.PROCESSING],
            },
          },
        }),
        tx.storeSyncRecordChunk.aggregate({
          where: {
            storeSyncRecordID,
          },
          _sum: {
            insertedRecords: true,
            failedRecords: true,
          },
        }),
      ]);

      if (failedChunk) {
        await tx.storeSyncRecord.update({
          where: {
            id: storeSyncRecordID,
          },
          data: {
            status: SyncStatus.FAILED,
            completedAt: new Date(),
            insertedRecords: aggregate._sum.insertedRecords ?? 0,
            failedRecords: aggregate._sum.failedRecords ?? 0,
            errorMessage: failedChunk.errorMessage,
          },
        });
        return;
      }

      if (incompleteChunks > 0) {
        if (
          lockedRecord.status === SyncStatus.SUCCESS ||
          lockedRecord.status === SyncStatus.FAILED
        ) {
          return;
        }

        await tx.storeSyncRecord.update({
          where: {
            id: storeSyncRecordID,
          },
          data: {
            status: SyncStatus.PROCESSING,
            insertedRecords: aggregate._sum.insertedRecords ?? 0,
            failedRecords: aggregate._sum.failedRecords ?? 0,
            completedAt: null,
            errorMessage: null,
          },
        });
        return;
      }

      await tx.storeSyncRecord.update({
        where: {
          id: storeSyncRecordID,
        },
        data: {
          status: SyncStatus.SUCCESS,
          completedAt: new Date(),
          insertedRecords: aggregate._sum.insertedRecords ?? 0,
          failedRecords: aggregate._sum.failedRecords ?? 0,
          errorMessage: null,
        },
      });
    });
  }

  private isAppQueueMessage(value: unknown): value is AppQueueMessage {
    if (!value || typeof value !== 'object') return false;

    const message = value as Record<string, unknown>;

    if (!this.isIsoDate(message.createdAt) || !message.payload) {
      return false;
    }

    switch (message.type) {
      case 'SYNC_MY_HR_CHUNK':
      case 'SYNC_RECORD_CHUNK': {
        const payload = message.payload as Record<string, unknown>;
        return (
          typeof payload.chunkId === 'string' &&
          (message.type === 'SYNC_RECORD_CHUNK' ||
            message.version === undefined ||
            message.version === 1)
        );
      }

      case 'START_MY_HR_SYNC': {
        const payload = message.payload as Record<string, unknown>;
        return (
          message.version === 1 &&
          typeof payload.triggerId === 'string' &&
          ['CRON', 'MANUAL', 'CONTINUATION'].includes(String(payload.source)) &&
          this.isIsoDate(payload.scheduledFor)
        );
      }

      case 'CHECK_MY_HR_BATCH': {
        const payload = message.payload as Record<string, unknown>;
        return (
          message.version === 1 &&
          typeof payload.chunkId === 'string' &&
          typeof payload.batchId === 'string'
        );
      }

      case 'SYNC_RECORDS': {
        const payload = message.payload as Record<string, unknown>;

        if (!Array.isArray(payload.syncRecords)) return false;
        if (!this.isCreateStoreSyncRecord(payload.payload)) return false;

        return payload.syncRecords.every(
          (record) =>
            record &&
            typeof record === 'object' &&
            typeof (record as Record<string, unknown>).id === 'string' &&
            typeof (record as Record<string, unknown>).storesId === 'string',
        );
      }

      default:
        return false;
    }
  }

  private isIsoDate(value: unknown): value is string {
    return (
      typeof value === 'string' && !Number.isNaN(new Date(value).getTime())
    );
  }

  private isCreateStoreSyncRecord(
    value: unknown,
  ): value is CreateStoreSyncRecord {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const syncPayload = value as Record<string, unknown>;

    if (!Array.isArray(syncPayload.sync_record)) {
      return false;
    }

    return syncPayload.sync_record.every((record) => {
      if (!record || typeof record !== 'object') {
        return false;
      }

      const item = record as Record<string, unknown>;

      if (
        typeof item.device_id !== 'string' ||
        !Array.isArray(item.attendance_record)
      ) {
        return false;
      }

      return item.attendance_record.every((attendance) => {
        if (!attendance || typeof attendance !== 'object') {
          return false;
        }

        const log = attendance as Record<string, unknown>;

        return (
          typeof log.id === 'string' &&
          typeof log.employee_name === 'string' &&
          typeof log.employee_id === 'string' &&
          typeof log.log_date === 'string' &&
          typeof log.punch === 'number'
        );
      });
    });
  }

  private parseLogDate(value: string): Date {
    const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value);

    const normalized = hasTimezone ? value : `${value}Z`;

    const date = new Date(normalized);

    if (Number.isNaN(date.getTime())) {
      throw new Error(`Invalid attendance log date: ${value}`);
    }

    return date;
  }
}
