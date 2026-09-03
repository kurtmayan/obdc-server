import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { MyHrRecordSyncStatus, SyncStatus } from 'src/generated/prisma/enums';
import { MyHrPayload } from 'src/types/my-hr';
import { PrismaService } from '../prisma/prisma.service';
import { SqsQueueService } from '../sqs-queue/sqs-queue.service';
import { MY_HR_SYNC_ELIGIBLE_ATTENDANCE_WHERE } from './myhr-sync-eligibility';
import { MyHrService } from './myhr.service';

const TRIGGERED_AT = new Date('2026-09-03T06:00:00.000Z');

describe('MyHrService attendance scheduling', () => {
  const findSync = jest.fn();
  const createSync = jest.fn();
  const findActiveJob = jest.fn();
  const createJob = jest.fn();
  const findAttendance = jest.fn();
  const createChunk = jest.fn();
  const updateAttendanceSync = jest.fn();
  const createAttendanceSync = jest.fn();
  const findChunk = jest.fn();
  const updateChunk = jest.fn();
  const updateRecordStatus = jest.fn();
  const findJob = jest.fn();
  const updateJob = jest.fn();
  const sendMessage = jest.fn();
  const getConfig = jest.fn();

  const transactionClient = {
    myHrSync: {
      findFirst: findSync,
      create: createSync,
    },
    myHrSyncJob: {
      findFirst: findActiveJob,
      create: createJob,
    },
    attendanceRecord: {
      findMany: findAttendance,
    },
    myHrSyncChunk: {
      create: createChunk,
    },
    myHrAttendanceSync: {
      updateMany: updateAttendanceSync,
      createMany: createAttendanceSync,
    },
  };

  const transaction = jest.fn(
    async (callback: (client: typeof transactionClient) => Promise<unknown>) =>
      callback(transactionClient),
  );

  let service: MyHrService;

  beforeEach(() => {
    jest.clearAllMocks();

    findSync.mockResolvedValue({ id: 'sync-1' });
    createSync.mockResolvedValue({ id: 'sync-1' });
    findActiveJob.mockResolvedValue(null);
    createJob.mockResolvedValue({ id: 'job-1' });
    updateAttendanceSync.mockResolvedValue({ count: 0 });
    createAttendanceSync.mockResolvedValue({ count: 0 });
    updateChunk.mockResolvedValue({ count: 1 });
    updateRecordStatus.mockResolvedValue({ count: 1 });
    findJob.mockResolvedValue({
      id: 'job-1',
      status: SyncStatus.PROCESSING,
      chunks: [{ status: SyncStatus.FAILED }],
    });
    updateJob.mockResolvedValue({ id: 'job-1' });
    sendMessage.mockResolvedValue({});
    getConfig.mockReturnValue(undefined);

    let chunkNumber = 0;
    createChunk.mockImplementation(() =>
      Promise.resolve({ id: `chunk-${++chunkNumber}` }),
    );

    service = new MyHrService(
      {
        $transaction: transaction,
        myHrSyncChunk: {
          findUnique: findChunk,
          updateMany: updateChunk,
        },
        myHrAttendanceSync: {
          updateMany: updateRecordStatus,
        },
        myHrSyncJob: {
          findUnique: findJob,
          update: updateJob,
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

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('creates and queues every chunk for a 12,000-record snapshot', async () => {
    findAttendance.mockResolvedValue(createAttendanceRecords(12_000));

    await service.scheduleAttendanceSync(TRIGGERED_AT);

    expect(findAttendance).toHaveBeenCalledWith({
      where: {
        AND: [
          MY_HR_SYNC_ELIGIBLE_ATTENDANCE_WHERE,
          {
            createdAt: {
              lte: TRIGGERED_AT,
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
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    expect(createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          totalRecords: 12_000,
          startRecordId: 'attendance-0',
          endRecordId: 'attendance-11999',
        }),
      }),
    );
    expect(createChunk).toHaveBeenCalledTimes(24);
    expect(sendMessage).toHaveBeenCalledTimes(24);

    for (const [index, call] of sendMessage.mock.calls.entries()) {
      expect(call[0]).toEqual({
        type: 'SYNC_MY_HR_CHUNK',
        payload: {
          chunkId: `chunk-${index + 1}`,
        },
        createdAt: expect.any(String),
      });
    }
  });

  it('uses a configured chunk size', () => {
    getConfig.mockImplementation((key: string) =>
      key === 'MYHR_SYNC_CHUNK_SIZE' ? '1000' : undefined,
    );

    const chunks = service.chunkPayload(createPayload(1_201));

    expect(chunks.map((chunk) => chunk.length)).toEqual([1_000, 201]);
  });

  it('falls back to 500 records for an invalid chunk size', () => {
    getConfig.mockImplementation((key: string) =>
      key === 'MYHR_SYNC_CHUNK_SIZE' ? '0' : undefined,
    );

    const chunks = service.chunkPayload(createPayload(1_001));

    expect(chunks.map((chunk) => chunk.length)).toEqual([500, 500, 1]);
  });

  it('skips scheduling when another MyHR job is active', async () => {
    findActiveJob.mockResolvedValue({
      id: 'active-job',
      status: SyncStatus.PROCESSING,
    });

    await service.scheduleAttendanceSync(TRIGGERED_AT);

    expect(findAttendance).not.toHaveBeenCalled();
    expect(createJob).not.toHaveBeenCalled();
    expect(createChunk).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('does not create a job when the snapshot has no eligible records', async () => {
    findAttendance.mockResolvedValue([]);

    await service.scheduleAttendanceSync(TRIGGERED_AT);

    expect(createJob).not.toHaveBeenCalled();
    expect(createChunk).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('rejects an invalid trigger timestamp before querying the database', async () => {
    await expect(
      service.scheduleAttendanceSync(new Date('invalid')),
    ).rejects.toThrow('Invalid MyHR attendance sync trigger timestamp');

    expect(transaction).not.toHaveBeenCalled();
  });

  it('returns records to pending after a non-final upload failure', async () => {
    findChunk.mockResolvedValue(createPendingChunk(0));
    jest
      .spyOn(service, 'uploadBiometrics')
      .mockRejectedValue(new Error('MyHR unavailable'));

    await expect(service.processChunk('chunk-1')).rejects.toThrow(
      'MyHR unavailable',
    );

    expect(updateChunk).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          status: SyncStatus.PENDING,
          failedRecords: 0,
          completedAt: null,
        }),
      }),
    );
    expect(updateRecordStatus).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          status: MyHrRecordSyncStatus.PENDING,
          errorMessage: 'MyHR unavailable',
        }),
      }),
    );
    expect(findJob).not.toHaveBeenCalled();
  });

  it('permanently marks records failed after the final upload attempt', async () => {
    findChunk.mockResolvedValue(createPendingChunk(2));
    jest
      .spyOn(service, 'uploadBiometrics')
      .mockRejectedValue(new Error('MyHR rejected the chunk'));

    await expect(service.processChunk('chunk-1')).rejects.toThrow(
      'MyHR rejected the chunk',
    );

    expect(updateChunk).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          status: SyncStatus.FAILED,
          failedRecords: 1,
          errorMessage: 'MyHR rejected the chunk',
        }),
      }),
    );
    expect(updateRecordStatus).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          status: MyHrRecordSyncStatus.FAILED,
          errorMessage: 'MyHR rejected the chunk',
        }),
      }),
    );
    expect(updateJob).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: SyncStatus.FAILED,
        }),
      }),
    );
  });
});

function createPendingChunk(attemptCount: number) {
  return {
    id: 'chunk-1',
    status: SyncStatus.PENDING,
    attemptCount,
    totalRecords: 1,
    payload: createPayload(1),
    myHrSyncJobId: 'job-1',
  };
}

function createAttendanceRecords(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `attendance-${index}`,
    userId: `employee-${index}`,
    employeeName: `Employee ${index}`,
    createdAt: new Date(TRIGGERED_AT.getTime() - count + index),
    updatedAt: TRIGGERED_AT,
    logType: 1,
    logDate: TRIGGERED_AT,
    storeSyncRecordID: 'store-sync-1',
    storeSyncRecords: {
      store: {
        name: 'Store 1',
      },
    },
  }));
}

function createPayload(count: number): MyHrPayload[] {
  return Array.from({ length: count }, (_, index) => ({
    empid: `employee-${index}`,
    logdt: '09/03/2026',
    logtm: '09/03/2026 14:00',
    logstats: 1,
    location: 'Store 1',
  }));
}
