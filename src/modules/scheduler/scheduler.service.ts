import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SqsQueueService } from '../sqs-queue/sqs-queue.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sqsQueueService: SqsQueueService) {}

  //@Cron(CronExpression.EVERY_HOUR)
  @Cron('*/10 * * * * *')
  async handleCron(): Promise<void> {
    await this.queueMyHrAttendanceSync();
  }

  async queueMyHrAttendanceSync(): Promise<void> {
    await this.sqsQueueService.sendMessage({
      type: 'SYNC_MY_HR_ATTENDANCE',
      payload: {},
      createdAt: new Date().toISOString(),
    });

    this.logger.log('Queued MyHR attendance sync trigger.');
  }
}
