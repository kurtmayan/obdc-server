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
import { SyncStatus } from 'src/generated/prisma/enums';

type QueuedSyncRecord = {
  id: string;
  storesId: string;
};

type SyncInsertResult = {
  totalInserted: number;
  insertedCountBySyncRecord: Map<string, number>;
};

@Injectable()
export class SqsProcessor
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(SqsProcessor.name);
  private readonly queueUrl: string;

  private running = false;

  constructor(
    @Inject(SQS_CLIENT)
    private readonly sqsClient: SQSClient,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.queueUrl = this.configService.getOrThrow<string>('AWS_SQS_QUEUE_URL');
  }

  onApplicationBootstrap(): void {
    this.running = true;
    void this.poll();
  }

  onApplicationShutdown(): void {
    this.running = false;
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
            VisibilityTimeout: 60,
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

    try {
      const parsed: unknown = JSON.parse(Body);

      if (!this.isAppQueueMessage(parsed)) {
        throw new Error('Invalid SQS message structure');
      }

      await this.handleMessage(parsed);

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
    }
  }

  private async handleMessage(message: AppQueueMessage): Promise<void> {
    switch (message.type) {
      case 'SYNC_RECORDS':
        await this.processSyncRecords(message.payload);
        return;

      case 'SYNC_RECORD_CHUNK':
        await this.processSyncRecordChunk(message.payload);
        return;

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

    try {
      await this.prisma.storeSyncRecordChunk.update({
        where: {
          id: chunk.id,
        },
        data: {
          status: SyncStatus.PROCESSING,
          startedAt: new Date(),
          completedAt: null,
          errorMessage: null,
        },
      });

      if (!this.isCreateStoreSyncRecord(chunk.payload)) {
        throw new Error(`Invalid sync chunk payload: ${chunk.id}`);
      }

      await this.prisma.storeSyncRecord.update({
        where: {
          id: chunk.storeSyncRecordID,
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

      await this.finalizeStoreSyncRecord(chunk.storeSyncRecordID);

      this.logger.log(
        `Sync chunk ${chunk.id} completed. Inserted ${result.totalInserted} attendance records.`,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Unknown error occurred while syncing chunk';

      await this.prisma.storeSyncRecordChunk.update({
        where: {
          id: chunk.id,
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
    const [failedChunk, incompleteChunks, aggregate] = await Promise.all([
      this.prisma.storeSyncRecordChunk.findFirst({
        where: {
          storeSyncRecordID,
          status: SyncStatus.FAILED,
        },
        select: {
          errorMessage: true,
        },
      }),
      this.prisma.storeSyncRecordChunk.count({
        where: {
          storeSyncRecordID,
          status: {
            in: [SyncStatus.PENDING, SyncStatus.PROCESSING],
          },
        },
      }),
      this.prisma.storeSyncRecordChunk.aggregate({
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
      await this.prisma.storeSyncRecord.update({
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
      await this.prisma.storeSyncRecord.update({
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

    await this.prisma.storeSyncRecord.update({
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
  }

  private isAppQueueMessage(value: unknown): value is AppQueueMessage {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const message = value as Record<string, unknown>;

    if (typeof message.createdAt !== 'string') {
      return false;
    }

    if (!message.payload || typeof message.payload !== 'object') {
      return false;
    }

    if (message.type === 'SYNC_RECORD_CHUNK') {
      const chunkPayload = message.payload as Record<string, unknown>;

      return typeof chunkPayload.chunkId === 'string';
    }

    if (message.type !== 'SYNC_RECORDS') {
      return false;
    }

    const messagePayload = message.payload as Record<string, unknown>;

    if (!messagePayload.payload || typeof messagePayload.payload !== 'object') {
      return false;
    }

    if (!Array.isArray(messagePayload.syncRecords)) {
      return false;
    }

    if (!this.isCreateStoreSyncRecord(messagePayload.payload)) {
      return false;
    }

    const syncPayload = messagePayload.payload;

    const validSyncRecords = messagePayload.syncRecords.every((record) => {
      if (!record || typeof record !== 'object') {
        return false;
      }

      const item = record as Record<string, unknown>;

      return typeof item.id === 'string' && typeof item.storesId === 'string';
    });

    if (!validSyncRecords) {
      return false;
    }

    return validSyncRecords && this.isCreateStoreSyncRecord(syncPayload);
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
