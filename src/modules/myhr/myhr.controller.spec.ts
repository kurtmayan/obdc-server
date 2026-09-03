import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { SchedulerService } from '../scheduler/scheduler.service';
import { MyHrController } from './myhr.controller';
import { MyHrService } from './myhr.service';

jest.mock('@nestjs/schedule', () => ({
  Cron: () => () => undefined,
  CronExpression: {
    EVERY_HOUR: '0 0 * * * *',
  },
}));

describe('MyHrController', () => {
  const queueMyHrAttendanceSync = jest.fn();

  let controller: MyHrController;

  beforeEach(() => {
    jest.clearAllMocks();

    controller = new MyHrController(
      {} as MyHrService,
      {
        queueMyHrAttendanceSync,
      } as unknown as SchedulerService,
    );
  });

  it('reports when the synchronization trigger was queued', async () => {
    queueMyHrAttendanceSync.mockResolvedValue(true);

    await expect(controller.syncToMyHr()).resolves.toEqual({
      queued: true,
      message: 'MyHR attendance synchronization has been queued successfully.',
    });
  });

  it('reports when there are no eligible attendance records', async () => {
    queueMyHrAttendanceSync.mockResolvedValue(false);

    await expect(controller.syncToMyHr()).resolves.toEqual({
      queued: false,
      message: 'No eligible attendance records to sync to MyHR.',
    });
  });

  it('propagates trigger errors', async () => {
    queueMyHrAttendanceSync.mockRejectedValue(new Error('trigger failed'));

    await expect(controller.syncToMyHr()).rejects.toThrow('trigger failed');
  });
});
