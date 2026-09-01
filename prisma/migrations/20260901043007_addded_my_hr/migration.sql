-- CreateEnum
CREATE TYPE "LogStats" AS ENUM ('0', '1', '2');

-- CreateTable
CREATE TABLE "BiometricRecord" (
    "id" TEXT NOT NULL,
    "empid" TEXT NOT NULL,
    "logdt" TEXT NOT NULL,
    "logtm" TEXT NOT NULL,
    "logstats" "LogStats" NOT NULL,
    "location" TEXT NOT NULL,
    "batchID" TEXT NOT NULL,

    CONSTRAINT "BiometricRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MyHRBatch" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MyHRBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MyHrSync" (
    "id" TEXT NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),
    "lastRecordId" TEXT,
    "status" "SyncStatus" NOT NULL DEFAULT 'PENDING',
    "totalSynced" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MyHrSync_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BiometricRecord_empid_idx" ON "BiometricRecord"("empid");

-- CreateIndex
CREATE INDEX "BiometricRecord_batchID_idx" ON "BiometricRecord"("batchID");

-- AddForeignKey
ALTER TABLE "BiometricRecord" ADD CONSTRAINT "BiometricRecord_batchID_fkey" FOREIGN KEY ("batchID") REFERENCES "MyHRBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
