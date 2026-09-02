import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { SqsQueueService } from '../sqs-queue/sqs-queue.service';
import { MyHrService } from '../myhr/myhr.service';
import { MyHrRecordSyncStatus, SyncStatus } from 'src/generated/prisma/enums';
import { MyHrSyncPayload } from 'src/types/my-hr';

type TransactionClient = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];

type CreateSyncJobResult =
  | { type: 'NO_RECORDS' }
  | { type: 'CREATED'; job: { id: string }; chunks: { id: string }[]; totalRecords: number };

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly batchSize = 10000;
  private readonly jobPollIntervalMs = 5000;
  private readonly jobWaitTimeoutMs = 30 * 60 * 1000;
  private readonly sqsMaxAttempts = 3;
  private readonly sqsRetryDelayMs = 2000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sqsQueueService: SqsQueueService,
    private readonly myHrService: MyHrService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleCron() {
    try {
      this.logger.log('Starting MyHR attendance sync...');

      await this.waitForActiveJob();

      const scheduleResult = await this.createSyncJob();

      if (scheduleResult.type === 'NO_RECORDS') {
        this.logger.log('No new attendance records to sync.');
        return;
      }

      const { job, chunks, totalRecords } = scheduleResult;

      this.logger.log(`Found ${totalRecords} attendance records.`);
      this.logger.log(`Created MyHR sync job ${job.id} with ${chunks.length} chunks.`);

      try {
        for (const [index, syncChunk] of chunks.entries()) {
          await this.sendChunkWithRetry(syncChunk.id);
          this.logger.log(`Queued MyHR chunk ${index + 1}/${chunks.length}: ${syncChunk.id}`);
        }

        this.logger.log(`MyHR sync job ${job.id} queued successfully.`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        this.logger.error(`Failed to queue MyHR sync job ${job.id}: ${errorMessage}`);

        await this.markJobAsFailed(job.id, errorMessage);
      }
    } catch (error) {
      this.logger.error(
        'MyHR attendance sync scheduling failed',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private async waitForActiveJob(): Promise<void> {
    const startedWaitingAt = Date.now();

    while (true) {
      const activeJob = await this.prisma.myHrSyncJob.findFirst({
        where: {
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

      if (!activeJob) {
        this.logger.log('No active MyHR sync job. Continuing...');
        return;
      }

      if (Date.now() - startedWaitingAt >= this.jobWaitTimeoutMs) {
        throw new Error(
          `Timed out waiting for MyHR sync job ${activeJob.id} to finish. Current status: ${activeJob.status}`,
        );
      }

      this.logger.log(
        `MyHR sync job ${activeJob.id} is ${activeJob.status}. Waiting ${this.jobPollIntervalMs / 1000}s...`,
      );

      await this.sleep(this.jobPollIntervalMs);
    }
  }

  private async createSyncJob(): Promise<CreateSyncJobResult> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT pg_advisory_xact_lock(hashtext('myhr-attendance-scheduler'))
      `;

      const sync = await this.getOrCreateSync(tx);

      const activeJob = await tx.myHrSyncJob.findFirst({
        where: {
          myHrSyncId: sync.id,
          status: {
            in: [SyncStatus.PENDING, SyncStatus.PROCESSING],
          },
        },
        select: {
          id: true,
        },
      });

      if (activeJob) {
        throw new Error(`Another MyHR sync job became active: ${activeJob.id}`);
      }

      const attendanceRecords = await this.getUnsyncedAttendance(tx);

      if (attendanceRecords.length === 0) {
        return { type: 'NO_RECORDS' as const };
      }

      const payload: MyHrSyncPayload[] = attendanceRecords.map((record) => ({
        attendanceRecordId: record.id,
        empid: record.userId,
        logdt: this.formatDate(record.logDate),
        logtm: this.formatDateTime(record.logDate),
        logstats: record.logType,
        location: record.storeSyncRecords.store.name,
      }));

      const payloadChunks = this.myHrService.chunkPayload(payload);
      const firstRecord = attendanceRecords[0];
      const lastRecord = attendanceRecords[attendanceRecords.length - 1];

      const job = await tx.myHrSyncJob.create({
        data: {
          myHrSyncId: sync.id,
          status: SyncStatus.PROCESSING,
          startedAt: new Date(),
          totalRecords: attendanceRecords.length,
          startDate: firstRecord.createdAt,
          startRecordId: firstRecord.id,
          endDate: lastRecord.createdAt,
          endRecordId: lastRecord.id,
        },
        select: {
          id: true,
        },
      });

      const chunks: { id: string }[] = [];

      for (const chunkRecords of payloadChunks) {
        const payloadWithoutAttendanceId = chunkRecords.map(
          ({ attendanceRecordId: _attendanceRecordId, ...record }) => record,
        );

        const chunk = await tx.myHrSyncChunk.create({
          data: {
            myHrSyncJobId: job.id,
            status: SyncStatus.PENDING,
            totalRecords: chunkRecords.length,
            payload: payloadWithoutAttendanceId,
          },
          select: {
            id: true,
          },
        });

        for (const record of chunkRecords) {
          await tx.myHrAttendanceSync.upsert({
            where: {
              attendanceRecordId: record.attendanceRecordId,
            },
            create: {
              attendanceRecordId: record.attendanceRecordId,
              chunkId: chunk.id,
            },
            update: {
              status: MyHrRecordSyncStatus.PENDING,
              chunkId: chunk.id,
              batchId: null,
              errorMessage: null,
              startedAt: null,
            },
          });
        }

        chunks.push(chunk);
      }

      return {
        type: 'CREATED' as const,
        job,
        chunks,
        totalRecords: attendanceRecords.length,
      };
    });
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

    throw lastError instanceof Error ? lastError : new Error(`Failed to queue MyHR chunk ${chunkId}`);
  }

  private async markJobAsFailed(jobId: string, errorMessage: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
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
            in: [MyHrRecordSyncStatus.PENDING, MyHrRecordSyncStatus.PROCESSING],
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
    });
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

  private async getUnsyncedAttendance(tx: TransactionClient) {
    return tx.attendanceRecord.findMany({
      where: {
        OR: [
          { myHrSyncRecord: { is: null } },
          { myHrSyncRecord: { is: { status: MyHrRecordSyncStatus.FAILED } } },
        ],
      },
      include: {
        storeSyncRecords: {
          include: {
            store: true,
          },
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: this.batchSize,
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
