import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { SqsQueueService } from '../sqs-queue/sqs-queue.service';
import {
  LogStats,
  MyHrRecordSyncStatus,
  SyncStatus,
} from 'src/generated/prisma/enums';
import authenticateMyHr from 'src/lib/authenticateMyHr';
import { MyHrPayload, MyHrSyncPayload } from 'src/types/my-hr';
import { MY_HR_SYNC_ELIGIBLE_ATTENDANCE_WHERE } from './myhr-sync-eligibility';

type TransactionClient = Parameters<
  Parameters<PrismaService['$transaction']>[0]
>[0];

type AttendanceQueryClient = Pick<TransactionClient, 'attendanceRecord'>;

type CreateSyncJobResult =
  | {
      type: 'ACTIVE_JOB';
      job: { id: string; status: SyncStatus };
    }
  | {
      type: 'NO_RECORDS';
    }
  | {
      type: 'CREATED';
      job: { id: string };
      chunks: { id: string }[];
      totalRecords: number;
    };

type AttendanceRecordForSync = Awaited<
  ReturnType<MyHrService['getUnsyncedAttendance']>
>[number];

export type MyHrUploadResult = {
  batchId: string;
  sent: number;
  saved: number;
};

@Injectable()
export class MyHrService {
  private readonly logger = new Logger(MyHrService.name);
  private myHrToken: string | null = null;
  private readonly sqsMaxAttempts = 3;
  private readonly sqsRetryDelayMs = 2_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly sqsQueueService: SqsQueueService,
  ) {}

  private async getMyHrToken(): Promise<string> {
    if (!this.myHrToken) {
      this.myHrToken = await authenticateMyHr(this.configService);
    }

    return this.myHrToken;
  }

  private clearMyHrToken(): void {
    this.myHrToken = null;
  }

  async uploadBiometrics(payload: MyHrPayload[]): Promise<MyHrUploadResult> {
    if (payload.length === 0) {
      throw new Error('MyHR payload is empty');
    }

    let token = await this.getMyHrToken();

    const apiUrl =
      `${this.configService.getOrThrow<string>('MYHR_API_URL')}` +
      '/api/biometric/upload/bulk';

    let response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (response.status === 401) {
      this.clearMyHrToken();
      token = await this.getMyHrToken();

      response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
    }

    const responseBody = await response.text();

    if (!response.ok) {
      throw new Error(
        `MyHR upload failed: ${response.status} ${response.statusText} - ${responseBody}`,
      );
    }

    let responseJson: { batchId?: string };

    try {
      responseJson = responseBody ? JSON.parse(responseBody) : {};
    } catch {
      throw new Error(`MyHR returned invalid JSON: ${responseBody}`);
    }

    if (!responseJson.batchId) {
      throw new Error('MyHR upload succeeded but no batchId was returned');
    }

    const batch = await this.prisma.myHRBatch.create({
      data: {
        id: responseJson.batchId,
      },
    });

    const result = await this.prisma.biometricRecord.createMany({
      data: payload.map((record) => ({
        empid: record.empid,
        logdt: record.logdt,
        logtm: record.logtm,
        logstats: this.getLogStats(record.logstats),
        location: record.location,
        batchID: batch.id,
      })),
    });

    return {
      batchId: batch.id,
      sent: payload.length,
      saved: result.count,
    };
  }

  chunkPayload<T extends MyHrPayload>(payload: T[]): T[][] {
    const chunks: T[][] = [];
    const chunkSize = this.getChunkSize();

    for (let i = 0; i < payload.length; i += chunkSize) {
      chunks.push(payload.slice(i, i + chunkSize));
    }

    return chunks;
  }

  async scheduleAttendanceSync(triggeredAt: Date): Promise<void> {
    if (Number.isNaN(triggeredAt.getTime())) {
      throw new Error('Invalid MyHR attendance sync trigger timestamp');
    }

    this.logger.log('Starting queued MyHR attendance sync scheduling...');

    const scheduleResult = await this.createSyncJob(triggeredAt);

    if (scheduleResult.type === 'ACTIVE_JOB') {
      this.logger.log(
        `MyHR sync job ${scheduleResult.job.id} is ${scheduleResult.job.status}. Skipping this trigger.`,
      );
      return;
    }

    if (scheduleResult.type === 'NO_RECORDS') {
      this.logger.log('No new attendance records to sync.');
      return;
    }

    const { job, chunks, totalRecords } = scheduleResult;

    this.logger.log(
      `Created MyHR sync job ${job.id} with ${chunks.length} chunks for ${totalRecords} attendance records.`,
    );

    try {
      for (const [index, syncChunk] of chunks.entries()) {
        await this.sendChunkWithRetry(syncChunk.id);

        this.logger.log(
          `Queued MyHR chunk ${index + 1}/${chunks.length}: ${syncChunk.id}`,
        );
      }

      this.logger.log(`MyHR sync job ${job.id} queued successfully.`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logger.error(
        `Failed to queue MyHR sync job ${job.id}: ${errorMessage}`,
      );

      await this.markJobAsFailed(job.id, errorMessage);
    }
  }

  private async createSyncJob(triggeredAt: Date): Promise<CreateSyncJobResult> {
    const initialResult = await this.prisma.$transaction(
      async (tx) => {
        const sync = await this.getOrCreateSync(tx);

        const activeJob = await tx.myHrSyncJob.findFirst({
          where: {
            myHrSyncId: sync.id,
            status: {
              in: [SyncStatus.PENDING, SyncStatus.PROCESSING],
            },
          },
          orderBy: {
            startedAt: 'asc',
          },
          select: {
            id: true,
            status: true,
          },
        });

        if (activeJob) {
          return {
            type: 'ACTIVE_JOB' as const,
            job: activeJob,
          };
        }

        const attendanceRecords = await this.getUnsyncedAttendance(
          tx,
          triggeredAt,
        );

        if (attendanceRecords.length === 0) {
          return {
            type: 'NO_RECORDS' as const,
          };
        }

        const job = await tx.myHrSyncJob.create({
          data: {
            myHrSyncId: sync.id,
            status: SyncStatus.PROCESSING,
            startedAt: new Date(),
          },
          select: {
            id: true,
          },
        });

        return {
          type: 'CREATED' as const,
          job,
          attendanceRecords,
        };
      },
      {
        maxWait: 5_000,
        timeout: 15_000,
      },
    );

    if (
      initialResult.type === 'ACTIVE_JOB' ||
      initialResult.type === 'NO_RECORDS'
    ) {
      return initialResult;
    }

    const { job } = initialResult;

    try {
      const chunks: { id: string }[] = [];
      let attendanceRecords = initialResult.attendanceRecords;
      const firstRecord = attendanceRecords[0];
      let lastRecord = firstRecord;
      let totalRecords = 0;

      while (attendanceRecords.length > 0) {
        const payload: MyHrSyncPayload[] = attendanceRecords.map((record) =>
          this.buildPayload(record),
        );
        const chunk = await this.createChunk(job.id, payload);

        chunks.push(chunk);
        totalRecords += attendanceRecords.length;
        lastRecord = attendanceRecords[attendanceRecords.length - 1];

        this.logger.log(
          `Created MyHR chunk ${chunks.length}: ${chunk.id}`,
        );

        attendanceRecords = await this.getUnsyncedAttendance(
          this.prisma,
          triggeredAt,
        );
      }

      await this.prisma.myHrSyncJob.update({
        where: {
          id: job.id,
        },
        data: {
          totalRecords,
          startDate: firstRecord.createdAt,
          startRecordId: firstRecord.id,
          endDate: lastRecord.createdAt,
          endRecordId: lastRecord.id,
        },
      });

      return {
        type: 'CREATED',
        job,
        chunks,
        totalRecords,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      await this.markJobAsFailed(
        job.id,
        `Failed while creating sync chunks: ${errorMessage}`,
      );

      throw error;
    }
  }

  private async createChunk(
    jobId: string,
    chunkRecords: MyHrSyncPayload[],
  ): Promise<{ id: string }> {
    return this.prisma.$transaction(
      async (tx) => {
        const payloadWithoutAttendanceId = chunkRecords.map(
          ({ attendanceRecordId: _attendanceRecordId, ...record }) => record,
        );

        const chunk = await tx.myHrSyncChunk.create({
          data: {
            myHrSyncJobId: jobId,
            status: SyncStatus.PENDING,
            totalRecords: chunkRecords.length,
            payload: payloadWithoutAttendanceId,
          },
          select: {
            id: true,
          },
        });

        const attendanceRecordIds = chunkRecords.map(
          (record) => record.attendanceRecordId,
        );

        await tx.myHrAttendanceSync.updateMany({
          where: {
            attendanceRecordId: {
              in: attendanceRecordIds,
            },
          },
          data: {
            status: MyHrRecordSyncStatus.PENDING,
            chunkId: chunk.id,
            batchId: null,
            errorMessage: null,
            startedAt: null,
          },
        });

        await tx.myHrAttendanceSync.createMany({
          data: chunkRecords.map((record) => ({
            attendanceRecordId: record.attendanceRecordId,
            chunkId: chunk.id,
            status: MyHrRecordSyncStatus.PENDING,
          })),
          skipDuplicates: true,
        });

        return chunk;
      },
      {
        maxWait: 5_000,
        timeout: 15_000,
      },
    );
  }

  async processChunk(chunkId: string): Promise<void> {
    const chunk = await this.prisma.myHrSyncChunk.findUnique({
      where: {
        id: chunkId,
      },
    });

    if (!chunk) {
      this.logger.warn(
        `Ignoring stale MyHR sync chunk message. Chunk not found: ${chunkId}`,
      );
      return;
    }

    if (chunk.status === SyncStatus.SUCCESS) {
      await this.finalizeJob(chunk.myHrSyncJobId);
      return;
    }

    if (chunk.status === SyncStatus.FAILED) {
      await this.finalizeJob(chunk.myHrSyncJobId);
      return;
    }

    if (chunk.status === SyncStatus.PROCESSING) {
      const reclaimed = await this.prisma.myHrSyncChunk.updateMany({
        where: {
          id: chunkId,
          status: SyncStatus.PROCESSING,
          OR: [
            { startedAt: null },
            {
              startedAt: {
                lt: new Date(
                  Date.now() - this.getProcessingTimeoutMilliseconds(),
                ),
              },
            },
          ],
        },
        data: {
          status: SyncStatus.PENDING,
          startedAt: null,
        },
      });

      if (reclaimed.count === 0) {
        throw new Error(`MyHR sync chunk ${chunkId} is already processing`);
      }
    }

    const claimed = await this.prisma.myHrSyncChunk.updateMany({
      where: {
        id: chunkId,
        status: SyncStatus.PENDING,
      },
      data: {
        status: SyncStatus.PROCESSING,
        attemptCount: {
          increment: 1,
        },
        startedAt: new Date(),
        completedAt: null,
        errorMessage: null,
      },
    });

    if (claimed.count === 0) {
      const currentChunk = await this.prisma.myHrSyncChunk.findUnique({
        where: {
          id: chunkId,
        },
      });

      if (!currentChunk) {
        throw new Error(`MyHR sync chunk not found: ${chunkId}`);
      }

      if (
        currentChunk.status === SyncStatus.SUCCESS ||
        currentChunk.status === SyncStatus.FAILED
      ) {
        await this.finalizeJob(chunk.myHrSyncJobId);
        return;
      }

      throw new Error(`MyHR sync chunk ${chunkId} is already processing`);
    }

    await this.prisma.myHrAttendanceSync.updateMany({
      where: {
        chunkId,
        status: MyHrRecordSyncStatus.PENDING,
      },
      data: {
        status: MyHrRecordSyncStatus.PROCESSING,
        attemptCount: { increment: 1 },
        startedAt: new Date(),
        errorMessage: null,
      },
    });

    try {
      if (!this.isMyHrPayloadArray(chunk.payload)) {
        throw new Error(`Invalid MyHR sync chunk payload: ${chunkId}`);
      }

      const payload = chunk.payload;

      const result = await this.uploadBiometrics(payload);

      await this.prisma.$transaction(async (tx) => {
        await tx.myHrSyncChunk.update({
          where: {
            id: chunkId,
          },
          data: {
            status: SyncStatus.SUCCESS,
            insertedRecords: result.saved,
            failedRecords: 0,
            batchId: result.batchId,
            completedAt: new Date(),
            errorMessage: null,
          },
        });

        await tx.myHrAttendanceSync.updateMany({
          where: {
            chunkId,
            status: MyHrRecordSyncStatus.PROCESSING,
          },
          data: {
            status: MyHrRecordSyncStatus.SYNCED,
            batchId: result.batchId,
            syncedAt: new Date(),
            errorMessage: null,
          },
        });
      });

      await this.finalizeJob(chunk.myHrSyncJobId);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const isFinalAttempt =
        chunk.attemptCount + 1 >= this.getMaxChunkAttempts();

      await this.prisma.myHrSyncChunk.updateMany({
        where: {
          id: chunkId,
          status: SyncStatus.PROCESSING,
        },
        data: {
          status: isFinalAttempt ? SyncStatus.FAILED : SyncStatus.PENDING,
          failedRecords: isFinalAttempt ? chunk.totalRecords : 0,
          completedAt: isFinalAttempt ? new Date() : null,
          errorMessage,
        },
      });

      await this.prisma.myHrAttendanceSync.updateMany({
        where: {
          chunkId,
          status: MyHrRecordSyncStatus.PROCESSING,
        },
        data: {
          status: isFinalAttempt
            ? MyHrRecordSyncStatus.FAILED
            : MyHrRecordSyncStatus.PENDING,
          errorMessage,
          startedAt: null,
        },
      });

      if (isFinalAttempt) {
        await this.finalizeJob(chunk.myHrSyncJobId);
      }

      throw error;
    }
  }

  private buildPayload(record: AttendanceRecordForSync): MyHrSyncPayload {
    return {
      attendanceRecordId: record.id,
      empid: record.userId,
      logdt: this.formatDate(record.logDate),
      logtm: this.formatDateTime(record.logDate),
      logstats: record.logType,
      location: record.storeSyncRecords.store.name,
    };
  }

  private async sendChunkWithRetry(chunkId: string): Promise<void> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.sqsMaxAttempts; attempt++) {
      try {
        await this.sqsQueueService.sendMessage({
          type: 'SYNC_MY_HR_CHUNK',
          payload: {
            chunkId,
          },
          createdAt: new Date().toISOString(),
        });

        return;
      } catch (error) {
        lastError = error;

        this.logger.warn(
          `Failed to queue MyHR chunk ${chunkId}. Attempt ${attempt}/${this.sqsMaxAttempts}.`,
        );

        if (attempt < this.sqsMaxAttempts) {
          await this.sleep(this.sqsRetryDelayMs);
        }
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(`Failed to queue MyHR chunk ${chunkId}`);
  }

  private async markJobAsFailed(
    jobId: string,
    errorMessage: string,
  ): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        await tx.myHrSyncChunk.updateMany({
          where: {
            myHrSyncJobId: jobId,
            status: {
              in: [SyncStatus.PENDING, SyncStatus.PROCESSING],
            },
          },
          data: {
            status: SyncStatus.FAILED,
            completedAt: new Date(),
            errorMessage,
          },
        });

        await tx.myHrAttendanceSync.updateMany({
          where: {
            chunk: {
              myHrSyncJobId: jobId,
            },
            status: {
              in: [
                MyHrRecordSyncStatus.PENDING,
                MyHrRecordSyncStatus.PROCESSING,
              ],
            },
          },
          data: {
            status: MyHrRecordSyncStatus.FAILED,
            errorMessage,
            startedAt: null,
          },
        });

        await tx.myHrSyncJob.update({
          where: {
            id: jobId,
          },
          data: {
            status: SyncStatus.FAILED,
            completedAt: new Date(),
            errorMessage,
          },
        });
      },
      {
        maxWait: 5_000,
        timeout: 15_000,
      },
    );
  }

  private async getOrCreateSync(tx: TransactionClient) {
    const sync = await tx.myHrSync.findFirst();

    if (sync) {
      return sync;
    }

    return tx.myHrSync.create({
      data: {},
    });
  }

  private async getUnsyncedAttendance(
    client: AttendanceQueryClient,
    triggeredAt: Date,
  ) {
    return client.attendanceRecord.findMany({
      where: {
        AND: [
          MY_HR_SYNC_ELIGIBLE_ATTENDANCE_WHERE,
          {
            createdAt: {
              lte: triggeredAt,
            },
          },
        ],
      },
      select: {
        id: true,
        userId: true,
        createdAt: true,
        logDate: true,
        logType: true,
        storeSyncRecords: {
          select: {
            store: {
              select: {
                name: true,
              },
            },
          },
        },
      },
      orderBy: [
        {
          createdAt: 'asc',
        },
        {
          id: 'asc',
        },
      ],
      take: this.getChunkSize(),
    });
  }

  private getChunkSize(): number {
    return this.getPositiveIntegerConfig('MYHR_SYNC_CHUNK_SIZE', 500);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private getMaxChunkAttempts(): number {
    return this.getPositiveIntegerConfig('MYHR_MAX_CHUNK_ATTEMPTS', 3);
  }

  private getProcessingTimeoutMilliseconds(): number {
    const sqsVisibilityTimeoutSeconds = this.getPositiveIntegerConfig(
      'AWS_SQS_VISIBILITY_TIMEOUT_SECONDS',
      300,
    );
    const timeoutSeconds = this.getPositiveIntegerConfig(
      'MYHR_CHUNK_PROCESSING_TIMEOUT_SECONDS',
      sqsVisibilityTimeoutSeconds + 60,
    );

    return timeoutSeconds * 1000;
  }

  private getPositiveIntegerConfig(key: string, fallback: number): number {
    const value = Number(this.configService.get<string>(key));

    return Number.isInteger(value) && value > 0 ? value : fallback;
  }

  private isMyHrPayloadArray(value: unknown): value is MyHrPayload[] {
    if (!Array.isArray(value)) {
      return false;
    }

    return value.every((record) => {
      if (!record || typeof record !== 'object') {
        return false;
      }

      const payload = record as Record<string, unknown>;

      return (
        typeof payload.empid === 'string' &&
        typeof payload.logdt === 'string' &&
        typeof payload.logtm === 'string' &&
        typeof payload.logstats === 'number' &&
        typeof payload.location === 'string'
      );
    });
  }

  private async finalizeJob(jobId: string): Promise<void> {
    const job = await this.prisma.myHrSyncJob.findUnique({
      where: {
        id: jobId,
      },
      include: {
        chunks: true,
      },
    });

    if (!job) {
      throw new Error(`MyHR sync job not found: ${jobId}`);
    }

    if (job.status === SyncStatus.FAILED) {
      return;
    }

    const hasFailedChunk = job.chunks.some(
      (chunk) => chunk.status === SyncStatus.FAILED,
    );

    if (hasFailedChunk) {
      await this.prisma.myHrSyncJob.update({
        where: {
          id: jobId,
        },
        data: {
          status: SyncStatus.FAILED,
          completedAt: new Date(),
        },
      });

      return;
    }

    const hasIncompleteChunk = job.chunks.some(
      (chunk) =>
        chunk.status === SyncStatus.PENDING ||
        chunk.status === SyncStatus.PROCESSING,
    );

    if (hasIncompleteChunk) {
      return;
    }

    const insertedRecords = job.chunks.reduce(
      (total, chunk) => total + chunk.insertedRecords,
      0,
    );

    const failedRecords = job.chunks.reduce(
      (total, chunk) => total + chunk.failedRecords,
      0,
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.myHrSyncJob.update({
        where: {
          id: jobId,
        },
        data: {
          status: SyncStatus.SUCCESS,
          insertedRecords,
          failedRecords,
          completedAt: new Date(),
          errorMessage: null,
        },
      });
    });
  }

  async getMyHrRecord({ page, pageSize }: { page: number; pageSize: number }) {
    const skip = (page - 1) * pageSize;

    const [batches, total] = await Promise.all([
      this.prisma.myHRBatch.findMany({
        skip,
        take: pageSize,
        orderBy: {
          createdAt: 'desc',
        },
        include: {
          biometricRecords: true,
        },
      }),
      this.prisma.myHRBatch.count(),
    ]);

    const batchesWithStatus = await Promise.all(
      batches.map(async (batch) => {
        const status = await this.getBiometricUploadStatus(batch.id);

        return {
          ...batch,
          status,
        };
      }),
    );

    return {
      batches: batchesWithStatus,
      page,
      pageSize,
      totalItems: total,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async getBiometricsByBatchId(batchID: string) {
    return this.prisma.biometricRecord.findMany({
      where: {
        batchID,
      },
    });
  }

  async getMyHRBatchStatus(batchID: string) {
    const batch = await this.prisma.myHRBatch.findUnique({
      where: {
        id: batchID,
      },
    });

    if (!batch) {
      throw new NotFoundException(`MyHR batch ${batchID} not found`);
    }

    const status = await this.getBiometricUploadStatus(batchID);

    return {
      ...batch,
      status,
    };
  }

  private async getBiometricUploadStatus(batchId: string) {
    let token = await this.getMyHrToken();

    const apiUrl =
      `${this.configService.getOrThrow<string>('MYHR_API_URL')}` +
      `/api/biometric/upload/bulk/status/${batchId}`;

    let response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });

    if (response.status === 401) {
      this.clearMyHrToken();
      token = await this.getMyHrToken();

      response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
    }

    if (!response.ok) {
      const errorBody = await response.text();

      throw new Error(
        `MyHR status request failed: ${response.status} ${errorBody}`,
      );
    }

    return response.json();
  }

  private getLogStats(value: number): LogStats {
    switch (value) {
      case 1:
        return 'TIME_IN';
      case 2:
        return 'TIME_OUT';
      default:
        return 'NO_VALUE';
    }
  }

  private formatDate(date: Date): string {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();

    return `${month}/${day}/${year}`;
  }

  private formatDateTime(date: Date): string {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');

    return `${month}/${day}/${year} ${hours}:${minutes}`;
  }
}
