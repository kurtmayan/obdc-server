/*
  Warnings:

  - You are about to drop the column `errorMessage` on the `MyHrSync` table. All the data in the column will be lost.
  - You are about to drop the column `status` on the `MyHrSync` table. All the data in the column will be lost.
  - You are about to drop the column `totalSynced` on the `MyHrSync` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "MyHrSync" DROP COLUMN "errorMessage",
DROP COLUMN "status",
DROP COLUMN "totalSynced";

-- CreateTable
CREATE TABLE "MyHrSyncJob" (
    "id" TEXT NOT NULL,
    "status" "SyncStatus" NOT NULL DEFAULT 'PENDING',
    "totalRecords" INTEGER NOT NULL DEFAULT 0,
    "insertedRecords" INTEGER NOT NULL DEFAULT 0,
    "failedRecords" INTEGER NOT NULL DEFAULT 0,
    "startDate" TIMESTAMP(3),
    "startRecordId" TEXT,
    "endDate" TIMESTAMP(3),
    "endRecordId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "myHrSyncId" TEXT NOT NULL,

    CONSTRAINT "MyHrSyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MyHrSyncChunk" (
    "id" TEXT NOT NULL,
    "status" "SyncStatus" NOT NULL DEFAULT 'PENDING',
    "totalRecords" INTEGER NOT NULL,
    "insertedRecords" INTEGER NOT NULL DEFAULT 0,
    "failedRecords" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB NOT NULL,
    "batchId" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "myHrSyncJobId" TEXT NOT NULL,

    CONSTRAINT "MyHrSyncChunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MyHrSyncJob_myHrSyncId_status_idx" ON "MyHrSyncJob"("myHrSyncId", "status");

-- CreateIndex
CREATE INDEX "MyHrSyncChunk_myHrSyncJobId_status_idx" ON "MyHrSyncChunk"("myHrSyncJobId", "status");

-- AddForeignKey
ALTER TABLE "MyHrSyncJob" ADD CONSTRAINT "MyHrSyncJob_myHrSyncId_fkey" FOREIGN KEY ("myHrSyncId") REFERENCES "MyHrSync"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MyHrSyncChunk" ADD CONSTRAINT "MyHrSyncChunk_myHrSyncJobId_fkey" FOREIGN KEY ("myHrSyncJobId") REFERENCES "MyHrSyncJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
