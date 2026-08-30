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

@Injectable()
export class SchedulerService {
    private readonly logger = new Logger(SchedulerService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly configService: ConfigService
    ) {}

    @Cron(CronExpression.EVERY_HOUR)
    async handleCron() {
        try {
            this.logger.log('Starting MyHR attendance sync...');

            // 1. Get or create sync record
            let sync = await this.prisma.myHrSync.findFirst();

            if (!sync) {
                sync = await this.prisma.myHrSync.create({
                    data: {},
                });
            }

            // 2. Get attendance records after the last synced record
            const attendanceRecords = await this.prisma.attendanceRecord.findMany({
                where: {
                    createdAt: {
                        gt: sync.lastSyncedAt ?? new Date(0),
                    },
                },
                include: {
                    storeSyncRecords: {
                        include: {
                            store: true
                        }
                    }
                },
                orderBy: [
                    {
                        createdAt: 'asc',
                    },
                    {
                        id: 'asc',
                    },
                ],
                take: 1000,
            });

            if (attendanceRecords.length === 0) {
                this.logger.log('No new attendance records to sync.');
                return;
            }

            this.logger.log(
                `Found ${attendanceRecords.length} attendance records.`,
            );

            // 3. Convert AttendanceRecord → MyHR payload
            const payload: MyHrPayload[] = attendanceRecords.map((record) => ({
                empid: record.userId,
                logdt: this.formatDate(record.logDate),
                logtm: this.formatDateTime(record.logDate),
                logstats: record.logType,
                location: record.storeSyncRecords.store.location,
            }));

            // 4. Send to MyHR
            await this.insertMyHrPayload(payload);

            // 5. Update sync cursor ONLY after successful API request
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

    private formatDate(date: Date): string {
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();

        return `${day}/${month}/${year}`;
    }

    private formatDateTime(date: Date): string {
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');

        return `${day}/${month}/${year} ${hours}:${minutes}`;
    }

    private async insertMyHrPayload(payload: MyHrPayload[]) {
        if (payload.length === 0) {
            return {
                totalInserted: 0,
                insertedCountBySyncRecord: new Map(),
            };
        }

        const token = await authenticateMyHr(this.configService);
        const apiUrl = `${this.configService.getOrThrow<string>('MYHR_API_URL')}/api/biometric/upload/bulk`;

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
                logstats: record.logstats === 1,
                location: record.location,
                batchID: batch.id,
            })),
        });

        this.logger.log(
            `MyHR upload successful. Sent ${payload.length}, saved ${result.count}, batch ${batch.id}`,
        );
    }
}
