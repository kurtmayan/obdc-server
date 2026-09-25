import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { SqsQueueService } from '../sqs-queue/sqs-queue.service';
import { SchedulerService } from './scheduler.service';

jest.mock('@nestjs/schedule', () => ({
  Cron: () => () => undefined,
  CronExpression: {
    EVERY_HOUR: '0 0 * * * *',
  },
}));

describe('SchedulerService', () => {
  const findFirst = jest.fn();
  const getConfig = jest.fn();
  const sendMessage =
    jest.fn<
      (payload: {
        type: string;
        payload: Record<string, never>;
        createdAt: string;
      }) => Promise<unknown>
    >();

  let service: SchedulerService;

  beforeEach(() => {
    jest.clearAllMocks();
    getConfig.mockReturnValue(undefined);

    service = new SchedulerService(
      {
        attendanceRecord: {
          findFirst,
        },
      } as unknown as PrismaService,
      {
        get: getConfig,
      } as unknown as ConfigService,
      {
        sendMessage,
      } as unknown as SqsQueueService,
    );
  });

  it('queues a MyHR sync trigger with default eligibility when pilot testing is disabled', async () => {
    findFirst.mockResolvedValue({ id: 'attendance-1' });
    sendMessage.mockResolvedValue({});

    await expect(service.queueMyHrAttendanceSync()).resolves.toBe(true);

    expect(sendMessage).toHaveBeenCalledTimes(1);

    const queuedMessage = sendMessage.mock.calls[0][0];
    const triggeredAt = new Date(queuedMessage.createdAt);

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        AND: [
          {
            myHrSyncRecord: {
              is: null,
            },
          },
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

    expect(queuedMessage.type).toBe('SYNC_MY_HR_ATTENDANCE');
    expect(queuedMessage.payload).toEqual({});
    expect(typeof queuedMessage.createdAt).toBe('string');
  });

  it('adds pilot restrictions to the trigger query when pilot testing is enabled', async () => {
    getConfig.mockImplementation((key: string) =>
      key === 'IS_PILOT_TESTING' ? 'TRUE' : undefined,
    );
    findFirst.mockResolvedValue({ id: 'attendance-1' });
    sendMessage.mockResolvedValue({});

    await expect(service.queueMyHrAttendanceSync()).resolves.toBe(true);

    const queuedMessage = sendMessage.mock.calls[0][0];
    const triggeredAt = new Date(queuedMessage.createdAt);

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        AND: [
          {
            AND: [
              {
                myHrSyncRecord: {
                  is: null,
                },
              },
              {
                logDate: {
                  gte: new Date('2026-09-22T00:00:00.000Z'),
                },
                storeSyncRecords: {
                  store: {
                    name: {
                      in: ['HOEW', 'HOEL'],
                    },
                  },
                },
              },
            ],
          },
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
  });

  it('skips SQS when no eligible attendance record exists', async () => {
    findFirst.mockResolvedValue(null);

    await expect(service.queueMyHrAttendanceSync()).resolves.toBe(false);

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('uses the guarded enqueue path from the cron handler', async () => {
    const queueSpy = jest
      .spyOn(service, 'queueMyHrAttendanceSync')
      .mockResolvedValue(false);

    await service.handleCron();

    expect(queueSpy).toHaveBeenCalledTimes(1);
  });

  it('propagates eligibility query errors without sending SQS', async () => {
    findFirst.mockRejectedValue(new Error('database unavailable'));

    await expect(service.queueMyHrAttendanceSync()).rejects.toThrow(
      'database unavailable',
    );
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('propagates SQS errors instead of reporting a successful queue', async () => {
    findFirst.mockResolvedValue({ id: 'attendance-1' });
    sendMessage.mockRejectedValue(new Error('SQS unavailable'));

    await expect(service.queueMyHrAttendanceSync()).rejects.toThrow(
      'SQS unavailable',
    );
  });
});
