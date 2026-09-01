import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { SqsQueueService } from '../sqs-queue/sqs-queue.service';
import { MyHrService } from '../myhr/myhr.service';
import { SyncStatus } from 'src/generated/prisma/enums';
import { MyHrPayload } from 'src/types/my-hr';

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

        const attendanceRecords = await this.getUnsyncedAttendance(sync);

        if (attendanceRecords.length === 0) {
            this.logger.log('No new attendance records to sync.');
            return;
        }

        this.logger.log(
            `Found ${attendanceRecords.length} attendance records.`,
        );

        const payload: MyHrPayload[] = attendanceRecords.map((record) => ({
            empid: record.userId,
            logdt: this.formatDate(record.logDate),
            logtm: this.formatDateTime(record.logDate),
            logstats: record.logType,
            location: record.storeSyncRecords.store.name,
        }));

        const chunks = this.myHrService.chunkPayload(payload);

        const firstRecord = attendanceRecords[0];
        const lastRecord =
            attendanceRecords[attendanceRecords.length - 1];

        const job = await this.prisma.myHrSyncJob.create({
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

        this.logger.log(
            `Created MyHR sync job ${job.id} with ${chunks.length} chunks.`,
        );

        for (const [index, chunk] of chunks.entries()) {
            const syncChunk = await this.prisma.myHrSyncChunk.create({
                data: {
                    myHrSyncJobId: job.id,
                    status: SyncStatus.PENDING,
                    totalRecords: chunk.length,
                    payload: chunk,
                },
            });

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

        this.logger.log(
            `MyHR sync job ${job.id} queued successfully.`,
        );
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

    private async getUnsyncedAttendance(sync: {
        lastSyncedAt: Date | null;
        lastRecordId: string | null;
    }) {
        if (!sync.lastSyncedAt) {
        return this.prisma.attendanceRecord.findMany({
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

        return this.prisma.attendanceRecord.findMany({
        where: {
            OR: [
            {
                createdAt: {
                gt: sync.lastSyncedAt,
                },
            },
            {
                createdAt: sync.lastSyncedAt,
                id: {
                gt: sync.lastRecordId ?? '',
                },
            },
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