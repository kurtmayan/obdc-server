import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, SyncStatus } from '../../src/generated/prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const storeSyncRecords = await prisma.storeSyncRecord.findMany({
    where: {
      status: SyncStatus.PENDING,
    },
    select: {
      id: true,
      syncDate: true,
    },
  });

  console.log(`Found ${storeSyncRecords.length} pending sync records`);

  for (const syncRecord of storeSyncRecords) {
    const attendanceCount = await prisma.attendanceRecord.count({
      where: {
        storeSyncRecordID: syncRecord.id,
      },
    });

    await prisma.storeSyncRecord.update({
      where: {
        id: syncRecord.id,
      },
      data: {
        status: SyncStatus.SUCCESS,
        totalRecords: attendanceCount,
        insertedRecords: attendanceCount,
        failedRecords: 0,
        errorMessage: null,
        completedAt: syncRecord.syncDate,
        startedAt: syncRecord.syncDate,
      },
    });

    console.log(
      `Updated syncRecord ${syncRecord.id}: ${attendanceCount} records`,
    );
  }

  console.log('Normalization completed');
}

main()
  .catch((e) => {
    console.error('Migration failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
