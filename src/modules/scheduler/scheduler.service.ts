import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SqsQueueService } from '../sqs-queue/sqs-queue.service';
import { PrismaService } from '../prisma/prisma.service';
import { getMyHrSyncEligibleAttendanceWhere } from '../myhr/myhr-sync-eligibility';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly sqsQueueService: SqsQueueService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  // @Cron('*/10 * * * * *')
  async handleCron(): Promise<void> {
    await this.queueMyHrAttendanceSync();
  }

  async queueMyHrAttendanceSync(): Promise<boolean> {
    const triggeredAt = new Date();
    const eligibleAttendanceWhere = getMyHrSyncEligibleAttendanceWhere(
      this.configService,
    );
    const attendanceRecord = await this.prisma.attendanceRecord.findFirst({
      where: {
        AND: [
          eligibleAttendanceWhere,
          {
            createdAt: {
              lte: triggeredAt,
            },
          },
        ],
      },
      select: {
        id: true,
      },
    });

    if (!attendanceRecord) {
      this.logger.log('No eligible attendance records to sync to MyHR.');
      return false;
    }

    await this.sqsQueueService.sendMessage({
      type: 'SYNC_MY_HR_ATTENDANCE',
      payload: {},
      createdAt: triggeredAt.toISOString(),
    });

    this.logger.log('Queued MyHR attendance sync trigger.');
    return true;
  }
}
