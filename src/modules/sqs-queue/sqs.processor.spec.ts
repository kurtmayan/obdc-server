import { SQSClient } from '@aws-sdk/client-sqs';
import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Status, SyncStatus } from 'src/generated/prisma/enums';
import { SyncChunkMessage } from 'src/types/sqs-message';
import { MyHrService } from '../myhr/myhr.service';
import { PrismaService } from '../prisma/prisma.service';
import { SqsProcessor } from './sqs.processor';

type ProcessorInternals = {
  finalizeStoreSyncRecord(storeSyncRecordID: string): Promise<void>;
  insertSyncPayload(): Promise<{
    totalInserted: number;
    insertedCountBySyncRecord: Map<string, number>;
  }>;
  processSyncRecordChunk(payload: SyncChunkMessage): Promise<void>;
};

describe('SqsProcessor store sync finalization', () => {
  const executeRaw = jest.fn<(...args: unknown[]) => Promise<number>>();
  const transaction = jest.fn();
  const chunkFindUnique = jest.fn();
  const chunkUpdate = jest.fn();
  const chunkUpdateMany = jest.fn();
  const recordUpdateMany = jest.fn();

  let processor: SqsProcessor;
  let internals: ProcessorInternals;

  beforeEach(() => {
    jest.clearAllMocks();

    executeRaw.mockResolvedValue(1);
    chunkUpdate.mockResolvedValue({});
    chunkUpdateMany.mockResolvedValue({ count: 1 });
    recordUpdateMany.mockResolvedValue({ count: 1 });

    processor = new SqsProcessor(
      {} as SQSClient,
      {
        getOrThrow: jest.fn(() => 'https://sqs.example.test/queue'),
        get: jest.fn(() => undefined),
      } as unknown as ConfigService,
      {
        $executeRaw: executeRaw,
        $transaction: transaction,
        storeSyncRecord: {
          updateMany: recordUpdateMany,
        },
        storeSyncRecordChunk: {
          findUnique: chunkFindUnique,
          update: chunkUpdate,
          updateMany: chunkUpdateMany,
        },
      } as unknown as PrismaService,
      {} as MyHrService,
    );

    internals = processor as unknown as ProcessorInternals;
  });

  function getFinalizationSql(): string {
    const [strings] = executeRaw.mock.calls[0] as unknown as [
      TemplateStringsArray,
      ...unknown[],
    ];

    return strings.join('?').replace(/\s+/g, ' ').trim();
  }

  it('uses one conditional statement without an interactive transaction', async () => {
    await internals.finalizeStoreSyncRecord('record-1');

    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(transaction).not.toHaveBeenCalled();

    const sql = getFinalizationSql();

    expect(sql).not.toContain('FOR UPDATE');
    expect(sql).toContain('summary."chunkCount" > 0');
    expect(sql).toContain('summary."nonSuccessCount" = 0');
    expect(sql).toContain("record.status = 'PROCESSING'");
  });

  it('gives failed chunks priority and selects their error deterministically', async () => {
    await internals.finalizeStoreSyncRecord('record-1');

    const sql = getFinalizationSql();
    const failedStatusPosition = sql.indexOf('THEN \'FAILED\'::"SyncStatus"');
    const successStatusPosition = sql.indexOf('THEN \'SUCCESS\'::"SyncStatus"');

    expect(failedStatusPosition).toBeGreaterThan(-1);
    expect(successStatusPosition).toBeGreaterThan(failedStatusPosition);
    expect(sql).toContain('ORDER BY chunk."chunkIndex" ASC');
    expect(sql).toContain("record.status <> 'SUCCESS'");
  });

  it('preserves terminal failure metadata while refreshing aggregate counts', async () => {
    await internals.finalizeStoreSyncRecord('record-1');

    const sql = getFinalizationSql();

    expect(sql).toContain(
      'WHEN record.status = \'FAILED\' THEN record."completedAt"',
    );
    expect(sql).toContain(
      'WHEN record.status = \'FAILED\' THEN record."errorMessage"',
    );
    expect(sql).toContain('"insertedRecords" = summary."insertedRecords"');
    expect(sql).toContain('"failedRecords" = summary."failedRecords"');
  });

  it('allows concurrent callers to use the same atomic finalization statement', async () => {
    await Promise.all([
      internals.finalizeStoreSyncRecord('record-1'),
      internals.finalizeStoreSyncRecord('record-1'),
    ]);

    expect(executeRaw).toHaveBeenCalledTimes(2);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('only transitions a pending parent to processing when a chunk starts', async () => {
    chunkFindUnique.mockResolvedValue({
      id: 'chunk-1',
      status: SyncStatus.PENDING,
      totalRecords: 1,
      payload: {
        sync_record: [
          {
            device_id: 'device-1',
            attendance_record: [],
          },
        ],
      },
      storeSyncRecordID: 'record-1',
      storeSyncRecord: {
        id: 'record-1',
        storesId: 'store-1',
        store: {
          name: 'Store 1',
          status: Status.active,
        },
      },
    });
    const insertSyncPayload = jest.fn<ProcessorInternals['insertSyncPayload']>(
      () =>
        Promise.resolve({
          totalInserted: 0,
          insertedCountBySyncRecord: new Map(),
        }),
    );
    internals.insertSyncPayload = insertSyncPayload;

    await internals.processSyncRecordChunk({ chunkId: 'chunk-1' });

    expect(recordUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'record-1',
          status: SyncStatus.PENDING,
        },
      }),
    );
    expect(chunkUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'chunk-1' },
        data: expect.objectContaining({ status: SyncStatus.SUCCESS }),
      }),
    );
    expect(executeRaw).toHaveBeenCalledTimes(1);
  });

  it('finalizes a duplicate successful chunk without processing it again', async () => {
    chunkFindUnique.mockResolvedValue({
      id: 'chunk-1',
      status: SyncStatus.SUCCESS,
      totalRecords: 1,
      payload: {},
      storeSyncRecordID: 'record-1',
      storeSyncRecord: {
        id: 'record-1',
        storesId: 'store-1',
        store: {
          name: 'Store 1',
          status: Status.active,
        },
      },
    });
    const insertSyncPayload = jest.fn<ProcessorInternals['insertSyncPayload']>(
      () =>
        Promise.resolve({
          totalInserted: 0,
          insertedCountBySyncRecord: new Map(),
        }),
    );
    internals.insertSyncPayload = insertSyncPayload;

    await internals.processSyncRecordChunk({ chunkId: 'chunk-1' });

    expect(insertSyncPayload).not.toHaveBeenCalled();
    expect(chunkUpdateMany).not.toHaveBeenCalled();
    expect(chunkUpdate).not.toHaveBeenCalled();
    expect(recordUpdateMany).not.toHaveBeenCalled();
    expect(executeRaw).toHaveBeenCalledTimes(1);
  });
});
