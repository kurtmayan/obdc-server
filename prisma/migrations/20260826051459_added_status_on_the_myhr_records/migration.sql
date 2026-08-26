-- CreateEnum
CREATE TYPE "MyHRStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "MyHRRecord" (
    "id" TEXT NOT NULL,
    "syncDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "MyHRStatus" NOT NULL DEFAULT 'PENDING',
    "totalRecords" INTEGER NOT NULL DEFAULT 0,
    "insertedRecords" INTEGER NOT NULL DEFAULT 0,
    "failedRecords" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "storesId" TEXT NOT NULL,

    CONSTRAINT "MyHRRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MyHRRecordChunk" (
    "id" TEXT NOT NULL,
    "myHRRecordID" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "status" "MyHRStatus" NOT NULL DEFAULT 'PENDING',
    "totalRecords" INTEGER NOT NULL DEFAULT 0,
    "insertedRecords" INTEGER NOT NULL DEFAULT 0,
    "failedRecords" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB NOT NULL,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MyHRRecordChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BiometricRecord" (
    "id" TEXT NOT NULL,
    "empid" TEXT NOT NULL,
    "logdt" TEXT NOT NULL,
    "logtm" TEXT NOT NULL,
    "logstats" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "myHRRecordID" TEXT NOT NULL,

    CONSTRAINT "BiometricRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MyHRRecord_storesId_syncDate_idx" ON "MyHRRecord"("storesId", "syncDate" DESC);

-- CreateIndex
CREATE INDEX "MyHRRecordChunk_status_idx" ON "MyHRRecordChunk"("status");

-- CreateIndex
CREATE INDEX "MyHRRecordChunk_myHRRecordID_status_idx" ON "MyHRRecordChunk"("myHRRecordID", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MyHRRecordChunk_myHRRecordID_chunkIndex_key" ON "MyHRRecordChunk"("myHRRecordID", "chunkIndex");

-- CreateIndex
CREATE INDEX "BiometricRecord_myHRRecordID_idx" ON "BiometricRecord"("myHRRecordID");

-- CreateIndex
CREATE INDEX "BiometricRecord_empid_idx" ON "BiometricRecord"("empid");

-- AddForeignKey
ALTER TABLE "MyHRRecord" ADD CONSTRAINT "MyHRRecord_storesId_fkey" FOREIGN KEY ("storesId") REFERENCES "Stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MyHRRecordChunk" ADD CONSTRAINT "MyHRRecordChunk_myHRRecordID_fkey" FOREIGN KEY ("myHRRecordID") REFERENCES "MyHRRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BiometricRecord" ADD CONSTRAINT "BiometricRecord_myHRRecordID_fkey" FOREIGN KEY ("myHRRecordID") REFERENCES "MyHRRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
