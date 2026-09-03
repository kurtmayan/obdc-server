import { ConfigService } from '@nestjs/config';
import {
  Cluster,
  Division,
  MyHrChunkStatus,
  MyHrJobStatus,
  MyHrTriggerOutcome,
  Status,
} from 'src/generated/prisma/enums';
import { MyHrClient } from 'src/modules/myhr/myhr.client';
import { MyHrSyncService } from 'src/modules/myhr/myhr-sync.service';
import { PrismaService } from 'src/modules/prisma/prisma.service';

const describeIntegration =
  process.env.MYHR_INTEGRATION === 'true' ? describe : describe.skip;

describeIntegration('MyHR synchronization database integration', () => {
  let prisma: PrismaService;
  let service: MyHrSyncService;

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    await prisma.$connect();
    service = new MyHrSyncService(
      prisma,
      new ConfigService({
        MYHR_JOB_RECORD_LIMIT: '3',
        MYHR_CHUNK_SIZE: '2',
        MYHR_RETENTION_DAYS: '30',
      }),
      {
        prepare: jest.fn(),
        upload: jest.fn(),
        getBatchStatus: jest.fn(),
      } as unknown as MyHrClient,
    );
  });

  beforeEach(async () => {
    await clearSchedulerData(prisma);
  });

  afterAll(async () => {
    await clearSchedulerData(prisma);
    await prisma.$disconnect();
  });

  it('deduplicates concurrent triggers, bounds selection, and creates one chunk set', async () => {
    await seedAttendance(prisma, 5);

    await Promise.all([
      service.handleTrigger(trigger('replica-a')),
      service.handleTrigger(trigger('replica-b')),
      service.handleTrigger(trigger('replica-a')),
    ]);

    const [jobs, triggers, chunks, deliveries, outbox] = await Promise.all([
      prisma.myHrSyncJob.findMany(),
      prisma.myHrSyncTrigger.findMany(),
      prisma.myHrSyncChunk.findMany({ orderBy: { sequence: 'asc' } }),
      prisma.myHrAttendanceSync.findMany(),
      prisma.myHrOutbox.findMany(),
    ]);

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      status: MyHrJobStatus.PROCESSING,
      totalRecords: 3,
    });
    expect(triggers).toHaveLength(2);
    expect(triggers.map((item) => item.outcome).sort()).toEqual([
      MyHrTriggerOutcome.COALESCED,
      MyHrTriggerOutcome.CREATED,
    ]);
    expect(chunks.map((item) => item.totalRecords)).toEqual([2, 1]);
    expect(deliveries).toHaveLength(3);
    expect(outbox).toHaveLength(2);
  });

  it('recreates missing outbox work and schedules a continuation for backlog', async () => {
    await seedAttendance(prisma, 5);
    await service.handleTrigger(trigger('first-job'));

    await prisma.myHrOutbox.deleteMany();
    await service.reconcile();
    expect(await prisma.myHrOutbox.count()).toBe(2);

    const job = await prisma.myHrSyncJob.findFirstOrThrow();
    await prisma.myHrSyncChunk.updateMany({
      where: { myHrSyncJobId: job.id },
      data: { status: MyHrChunkStatus.SUCCESS, completedAt: new Date() },
    });
    await service.reconcile();

    expect(
      await prisma.myHrSyncJob.findUnique({ where: { id: job.id } }),
    ).toMatchObject({
      status: MyHrJobStatus.SUCCESS,
      insertedRecords: 3,
    });
    expect(
      await prisma.myHrOutbox.findUnique({
        where: { dedupKey: `continuation:${job.id}` },
      }),
    ).not.toBeNull();
  });
});

function trigger(triggerId: string) {
  return {
    triggerId,
    source: 'CRON' as const,
    scheduledFor: new Date().toISOString(),
  };
}

async function seedAttendance(prisma: PrismaService, count: number) {
  const store = await prisma.stores.create({
    data: {
      name: 'Integration Store',
      division: Division.rtm_operations,
      location: 'Manila',
      cluster: Cluster.ncr_north_east,
      status: Status.active,
    },
  });
  const sync = await prisma.storeSyncRecord.create({
    data: { storesId: store.id },
  });
  const base = new Date('2026-09-02T00:00:00.000Z').getTime();
  await prisma.attendanceRecord.createMany({
    data: Array.from({ length: count }, (_, index) => ({
      userId: `employee-${index}`,
      employeeName: `Employee ${index}`,
      logType: index % 2,
      logDate: new Date(base + index * 60_000),
      createdAt: new Date(base + index * 60_000),
      storeSyncRecordID: sync.id,
    })),
  });
}

async function clearSchedulerData(prisma: PrismaService) {
  await prisma.myHrOutbox.deleteMany();
  await prisma.myHrSyncTrigger.deleteMany();
  await prisma.myHrUploadAttempt.deleteMany();
  await prisma.myHrAttendanceSync.deleteMany();
  await prisma.myHrSyncChunk.deleteMany();
  await prisma.myHrSyncJob.deleteMany();
  await prisma.myHrSync.deleteMany();
  await prisma.attendanceRecord.deleteMany();
  await prisma.storeSyncRecordChunk.deleteMany();
  await prisma.storeSyncRecord.deleteMany();
  await prisma.devices.deleteMany();
  await prisma.stores.deleteMany();
}
