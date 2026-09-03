import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { formatInTimeZone } from 'date-fns-tz';
import {
  MyHrTriggerSource,
  VersionedQueueMessage,
} from 'src/types/sqs-message';
import { SqsQueueService } from '../sqs-queue/sqs-queue.service';

export type MyHrTriggerReceipt = {
  triggerId: string;
  messageId?: string;
  status: 'QUEUED' | 'DISABLED';
};

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly timezone = 'Asia/Manila';

  constructor(
    private readonly sqsQueueService: SqsQueueService,
    private readonly configService: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR, {
    name: 'myhr-hourly-trigger',
    timeZone: 'Asia/Manila',
    waitForCompletion: true,
  })
  async handleCron(): Promise<MyHrTriggerReceipt> {
    const scheduledFor = new Date();
    const triggerId = `myhr:cron:${formatInTimeZone(
      scheduledFor,
      this.timezone,
      "yyyy-MM-dd'T'HH",
    )}`;

    return this.publishTrigger(triggerId, 'CRON', scheduledFor);
  }

  async triggerManually(): Promise<MyHrTriggerReceipt> {
    return this.publishTrigger(
      `myhr:manual:${randomUUID()}`,
      'MANUAL',
      new Date(),
    );
  }

  private async publishTrigger(
    triggerId: string,
    source: MyHrTriggerSource,
    scheduledFor: Date,
  ): Promise<MyHrTriggerReceipt> {
    if (!this.isEnabled()) {
      this.logger.warn(`MyHR sync is disabled; skipped trigger ${triggerId}`);
      return { triggerId, status: 'DISABLED' };
    }

    const message: VersionedQueueMessage<
      'START_MY_HR_SYNC',
      {
        triggerId: string;
        source: MyHrTriggerSource;
        scheduledFor: string;
      }
    > = {
      version: 1,
      type: 'START_MY_HR_SYNC',
      payload: {
        triggerId,
        source,
        scheduledFor: scheduledFor.toISOString(),
      },
      createdAt: new Date().toISOString(),
    };

    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const result = await this.sqsQueueService.sendMessage(message);
        this.logger.log(
          `event=myhr_trigger_queued triggerId=${triggerId} source=${source} messageId=${result.MessageId ?? 'unknown'}`,
        );
        return {
          triggerId,
          messageId: result.MessageId,
          status: 'QUEUED',
        };
      } catch (error) {
        lastError = error;
        this.logger.warn(
          `event=myhr_trigger_queue_failed triggerId=${triggerId} attempt=${attempt}`,
        );
        if (attempt < 3) {
          const delayMs =
            500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }

    this.logger.error(
      `event=myhr_trigger_queue_exhausted triggerId=${triggerId}`,
      lastError instanceof Error ? lastError.stack : String(lastError),
    );
    throw new ServiceUnavailableException(
      'Unable to queue MyHR synchronization',
    );
  }

  private isEnabled(): boolean {
    return (
      this.configService.get<string>('MYHR_SYNC_ENABLED', 'false') === 'true'
    );
  }
}
