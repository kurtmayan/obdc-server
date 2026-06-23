import { PrismaClient } from '../../src/generated/prisma/client';

export async function seedBackupSyncCount(prisma: PrismaClient) {
  const backup = [
    {
      syncDate: '2026-05-27',
      totalSyncedSuccess: 87,
    },
    {
      syncDate: '2026-05-26',
      totalSyncedSuccess: 75,
    },
    {
      syncDate: '2026-05-25',
      totalSyncedSuccess: 84,
    },
    {
      syncDate: '2026-05-24',
      totalSyncedSuccess: 75,
    },
    {
      syncDate: '2026-05-23',
      totalSyncedSuccess: 79,
    },
    {
      syncDate: '2026-05-22',
      totalSyncedSuccess: 83,
    },
    {
      syncDate: '2026-05-21',
      totalSyncedSuccess: 77,
    },
    {
      syncDate: '2026-05-20',
      totalSyncedSuccess: 72,
    },
    {
      syncDate: '2026-05-19',
      totalSyncedSuccess: 74,
    },
    {
      syncDate: '2026-05-18',
      totalSyncedSuccess: 60,
    },
    {
      syncDate: '2026-05-17',
      totalSyncedSuccess: 15,
    },
    {
      syncDate: '2026-05-15',
      totalSyncedSuccess: 88,
    },
    {
      syncDate: '2026-05-14',
      totalSyncedSuccess: 3,
    },
    {
      syncDate: '2026-05-13',
      totalSyncedSuccess: 6,
    },
    {
      syncDate: '2026-05-12',
      totalSyncedSuccess: 3,
    },
    {
      syncDate: '2026-05-11',
      totalSyncedSuccess: 1,
    },
    {
      syncDate: '2026-05-08',
      totalSyncedSuccess: 1,
    },
    {
      syncDate: '2026-05-06',
      totalSyncedSuccess: 1,
    },
    {
      syncDate: '2026-05-05',
      totalSyncedSuccess: 1,
    },
  ];

  // Get existing sync dates to avoid duplicates
  const existingRecords = await prisma.syncStatistics.findMany({
    select: { syncDate: true },
  });

  const existingDates = new Set(
    existingRecords.map(
      (record) => record.syncDate.toISOString().split('T')[0],
    ),
  );

  // Filter backup to only include dates that don't exist
  const newRecords = backup.filter((item) => !existingDates.has(item.syncDate));

  if (newRecords.length > 0) {
    await prisma.syncStatistics.createMany({
      data: newRecords.map((item) => ({
        totalSyncedSuccess: item.totalSyncedSuccess,
        syncDate: new Date(`${item.syncDate}T00:00:00.000Z`),
      })),
    });
    console.log(
      `  ✔ Backup sync counts seeded (${newRecords.length} records added)`,
    );
  } else {
    console.log('  ✔ Backup sync counts already exist, skipping...');
  }
}
