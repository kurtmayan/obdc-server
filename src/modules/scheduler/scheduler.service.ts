import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import authenticateMyHr from 'src/lib/authenticateMyHr';

type MyHrPayload = {
    empid: string;
    logdt: string;
    logtm: string;
    logstats: number;
    location: string;
};

const MYHR_CHUNK_SIZE = 500;

@Injectable()
export class SchedulerService {
    private readonly logger = new Logger(SchedulerService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly configService: ConfigService,
    ) {}

    //@Cron('*/10 * * * * *')
    @Cron(CronExpression.EVERY_HOUR)
    async handleCron() {
        try {
            this.logger.log('Starting MyHR attendance sync...');

            let sync = await this.prisma.myHrSync.findFirst();

            if (!sync) {
                sync = await this.prisma.myHrSync.create({
                    data: {},
                });
            }

            const attendanceRecords = await this.prisma.attendanceRecord.findMany({
                where: {
                    createdAt: {
                        gt: sync.lastSyncedAt ?? new Date(0),
                    },
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
                take: 10000,
            });

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

            const chunks = this.chunkPayload(payload);

            this.logger.log(
                `Split ${payload.length} records into ${chunks.length} chunks.`,
            );

            for (const [index, chunk] of chunks.entries()) {
                this.logger.log(
                    `Uploading chunk ${index + 1}/${chunks.length} (${chunk.length} records)...`,
                );

                await this.insertMyHrPayload(chunk);

                this.logger.log(
                    `Chunk ${index + 1}/${chunks.length} uploaded successfully.`,
                );
            }

            const lastRecord = attendanceRecords[attendanceRecords.length - 1];

            await this.prisma.myHrSync.update({
                where: {
                    id: sync.id,
                },
                data: {
                    lastSyncedAt: lastRecord.createdAt,
                    lastRecordId: lastRecord.id,
                },
            });

            this.logger.log(
                `MyHR sync successful. Last synced record: ${lastRecord.id}`,
            );
        } catch (error) {
            this.logger.error(
                'MyHR attendance sync failed',
                error instanceof Error ? error.stack : error,
            );
        }
    }

    private chunkPayload(payload: MyHrPayload[]): MyHrPayload[][] {
        const chunks: MyHrPayload[][] = [];

        for (let i = 0; i < payload.length; i += MYHR_CHUNK_SIZE) {
            chunks.push(payload.slice(i, i + MYHR_CHUNK_SIZE));
        }

        return chunks;
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

    private async insertMyHrPayload(payload: MyHrPayload[]) {
        if (payload.length === 0) {
            return;
        }

        const token = await authenticateMyHr(this.configService);
        const apiUrl =
            `${this.configService.getOrThrow<string>('MYHR_API_URL')}` +
            `/api/biometric/upload/bulk`;

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(payload),
        });

        const responseBody = await response.text();

        this.logger.log(`MyHR upload status: ${response.status}`);

        if (!response.ok) {
            throw new Error(
                `MyHR endpoint failed: ${response.status} ${response.statusText} - ${responseBody}`,
            );
        }

        let responseJson: { batchId?: string };

        try {
            responseJson = responseBody ? JSON.parse(responseBody) : {};
        } catch {
            throw new Error(`MyHR returned invalid JSON: ${responseBody}`);
        }

        if (!responseJson.batchId) {
            throw new Error(
                'MyHR upload succeeded but no batchId was returned.',
            );
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
                logstats: record.logstats,
                location: record.location,
                batchID: batch.id,
            })),
        });

        this.logger.log(
            `MyHR upload successful. Sent ${payload.length}, saved ${result.count}, batch ${batch.id}`,
        );
    }
}