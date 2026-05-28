import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client';
import { seedUsers } from './seeds/users.seed';
import { seedStoresWithBiometric } from './seeds/store-with-biometric.seed';
import { PrismaPg } from '@prisma/adapter-pg';
import { seedBackupSyncCount } from './seeds/backup-sync-count.seed';

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log(
    '║          🌱 DATABASE SEEDING STARTED 🌱                     ║',
  );
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('\n');

  try {
    // Seed Users
    console.log('┌─ 👤 SEEDING USERS ─────────────────────────────────────┐');
    console.log('│');
    await seedUsers(prisma);
    console.log('│');
    console.log('└────────────────────────────────────────────────────────┘');
    console.log('✅ Users seeded successfully\n');

    // Seed Stores with Biometric
    console.log('┌─ 🏬 SEEDING STORES WITH BIOMETRIC ────────────────────┐');
    console.log('│');
    await seedStoresWithBiometric(prisma);
    console.log('│');
    console.log('└────────────────────────────────────────────────────────┘');
    console.log('✅ Stores with biometric seeded successfully\n');

    // Seed Backup Sync Count
    console.log('┌─ 📊 SEEDING BACKUP SYNC COUNT ────────────────────────┐');
    console.log('│');
    await seedBackupSyncCount(prisma);
    console.log('│');
    console.log('└────────────────────────────────────────────────────────┘');
    console.log('✅ Backup sync count seeded successfully\n');

    // Completion
    console.log(
      '╔════════════════════════════════════════════════════════════╗',
    );
    console.log(
      '║          ✨ SEEDING COMPLETED SUCCESSFULLY ✨              ║',
    );
    console.log(
      '╚════════════════════════════════════════════════════════════╝',
    );
    console.log('\n');
  } catch (error) {
    console.error('\n❌ Seeding failed:', error);
    throw error;
  }
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
