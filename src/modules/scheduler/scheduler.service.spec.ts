jest.mock('@nestjs/schedule', () => ({
  CronExpression: { EVERY_HOUR: '0 0 * * * *' },
  Cron:
    (_cronTime: string, options: Record<string, unknown>) =>
    (_target: object, _propertyKey: string, descriptor: PropertyDescriptor) => {
      Reflect.defineMetadata(
        'SCHEDULE_CRON_OPTIONS',
        options,
        descriptor.value as object,
      );
    },
}));

import { ConfigService } from '@nestjs/config';
import { SqsQueueService } from '../sqs-queue/sqs-queue.service';
import { SchedulerService } from './scheduler.service';

describe('SchedulerService', () => {
  it('does not publish while synchronization is disabled', async () => {
    const sqs = { sendMessage: jest.fn() } as unknown as SqsQueueService;
    const service = new SchedulerService(sqs, configWithEnabled(false));

    await expect(service.triggerManually()).resolves.toMatchObject({
      status: 'DISABLED',
    });
    expect(sqs.sendMessage).not.toHaveBeenCalled();
  });

  it('awaits publication and returns the SQS message ID', async () => {
    const sqs = {
      sendMessage: jest.fn().mockResolvedValue({ MessageId: 'message-1' }),
    } as unknown as SqsQueueService;
    const service = new SchedulerService(sqs, configWithEnabled(true));

    await expect(service.triggerManually()).resolves.toMatchObject({
      messageId: 'message-1',
      status: 'QUEUED',
    });
    expect(sqs.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 1,
        type: 'START_MY_HR_SYNC',
        payload: expect.objectContaining({ source: 'MANUAL' }),
      }),
    );
  });

  it('declares one named hourly Manila cron with overlap protection', () => {
    const metadata = Reflect.getMetadata(
      'SCHEDULE_CRON_OPTIONS',
      SchedulerService.prototype.handleCron,
    ) as Record<string, unknown>;

    expect(metadata).toMatchObject({
      name: 'myhr-hourly-trigger',
      timeZone: 'Asia/Manila',
      waitForCompletion: true,
    });
  });
});

function configWithEnabled(enabled: boolean): ConfigService {
  return {
    get: jest.fn((_key: string, fallback: string) =>
      enabled ? 'true' : fallback,
    ),
  } as unknown as ConfigService;
}
