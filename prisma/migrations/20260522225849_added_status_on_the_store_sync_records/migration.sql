-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED');

-- AlterTable
ALTER TABLE "StoreSyncRecord" ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "errorMessage" TEXT,
ADD COLUMN     "failedRecords" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "insertedRecords" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "startedAt" TIMESTAMP(3),
ADD COLUMN     "status" "SyncStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "totalRecords" INTEGER NOT NULL DEFAULT 0;
