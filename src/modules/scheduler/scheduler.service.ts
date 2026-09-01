import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { SqsQueueService } from '../sqs-queue/sqs-queue.service';
import { MyHrService } from '../myhr/myhr.service';
import { MyHrRecordSyncStatus, SyncStatus } from 'src/generated/prisma/enums';
import { MyHrSyncPayload } from 'src/types/my-hr';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly batchSize = 10000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sqsQueueService: SqsQueueService,
    private readonly myHrService: MyHrService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleCron() {
    try {
      this.logger.log('Starting MyHR attendance sync...');

      const sync = await this.getOrCreateSync();

      const activeJob = await this.prisma.myHrSyncJob.findFirst({
        where: {
          myHrSyncId: sync.id,
          status: {
            in: [SyncStatus.PENDING, SyncStatus.PROCESSING],
          },
        },
      });

      if (activeJob) {
        this.logger.log(
          `MyHR sync already has an active job: ${activeJob.id}. Skipping.`,
        );
        return;
      }

      const attendanceRecords = await this.getUnsyncedAttendance();

      if (attendanceRecords.length === 0) {
        this.logger.log('No new attendance records to sync.');
        return;
      }

      this.logger.log(`Found ${attendanceRecords.length} attendance records.`);

      const payload: MyHrSyncPayload[] = attendanceRecords.map((record) => ({
        attendanceRecordId: record.id,
        empid: record.userId,
        logdt: this.formatDate(record.logDate),
        logtm: this.formatDateTime(record.logDate),
        logstats: record.logType,
        location: record.storeSyncRecords.store.name,
      }));

      const chunks = this.myHrService.chunkPayload(payload);

      const job = await this.prisma.$transaction(async (tx) => {
        const firstRecord = attendanceRecords[0];
        const lastRecord = attendanceRecords[attendanceRecords.length - 1];
        const job = await tx.myHrSyncJob.create({
          data: {
            myHrSyncId: sync.id,
            status: SyncStatus.PENDING,
            totalRecords: attendanceRecords.length,
            startDate: firstRecord.createdAt,
            startRecordId: firstRecord.id,
            endDate: lastRecord.createdAt,
            endRecordId: lastRecord.id,
          },
        });

        const createdChunks: { id: string }[] = [];

        for (const chunk of chunks) {
          const chunkRecords = chunk as Array<MyHrSyncPayload & { attendanceRecordId: string }>;

          const payloadWithoutAttendanceId = chunkRecords.map((record) => {
            const {
              attendanceRecordId: _attendanceRecordId,
              ...payload
            } = record;

            return payload;
          });

          const syncChunk = await tx.myHrSyncChunk.create({
            data: {
              myHrSyncJobId: job.id,
              status: SyncStatus.PENDING,
              totalRecords: chunkRecords.length,
              payload: payloadWithoutAttendanceId,
            },
          });

          for (const record of chunkRecords) {
            await tx.myHrAttendanceSync.upsert({
              where: { attendanceRecordId: record.attendanceRecordId },
              create: {
                attendanceRecordId: record.attendanceRecordId,
                chunkId: syncChunk.id,
              },
              update: {
                status: MyHrRecordSyncStatus.PENDING,
                chunkId: syncChunk.id,
                batchId: null,
                errorMessage: null,
                startedAt: null,
              },
            });
          }

          createdChunks.push(syncChunk);
        }

        return { ...job, chunks: createdChunks };
      });

      this.logger.log(
        `Created MyHR sync job ${job.id} with ${chunks.length} chunks.`,
      );

      for (const [index, syncChunk] of job.chunks.entries()) {
        await this.sqsQueueService.sendMessage({
          type: 'SYNC_MY_HR_CHUNK',
          payload: {
            chunkId: syncChunk.id,
          },
          createdAt: new Date().toISOString(),
        });

        this.logger.log(
          `Queued MyHR chunk ${index + 1}/${chunks.length}: ${syncChunk.id}`,
        );
      }

      await this.prisma.myHrSyncJob.update({
        where: {
          id: job.id,
        },
        data: {
          status: SyncStatus.PROCESSING,
          startedAt: new Date(),
        },
      });

      this.logger.log(`MyHR sync job ${job.id} queued successfully.`);
    } catch (error) {
      this.logger.error(
        'MyHR attendance sync scheduling failed',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private async getOrCreateSync() {
    const sync = await this.prisma.myHrSync.findFirst();

    if (sync) {
      return sync;
    }

    return this.prisma.myHrSync.create({
      data: {},
    });
  }

  private async getUnsyncedAttendance() {
    return this.prisma.attendanceRecord.findMany({
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
      orderBy: [
        {
          createdAt: 'asc',
        },
        {
          id: 'asc',
        },
      ],
      take: this.batchSize,
    });
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
