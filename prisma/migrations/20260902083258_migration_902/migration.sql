-- CreateEnum
CREATE TYPE "LogStats" AS ENUM ('0', '1', '2');

-- CreateEnum
CREATE TYPE "MyHrRecordSyncStatus" AS ENUM ('PENDING', 'PROCESSING', 'SYNCED', 'FAILED');

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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),

    CONSTRAINT "MyHrSync_pkey" PRIMARY KEY ("id")
);

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
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
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

-- CreateTable
CREATE TABLE "MyHrAttendanceSync" (
    "id" TEXT NOT NULL,
    "attendanceRecordId" TEXT NOT NULL,
    "status" "MyHrRecordSyncStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "batchId" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "chunkId" TEXT,

    CONSTRAINT "MyHrAttendanceSync_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BiometricRecord_empid_idx" ON "BiometricRecord"("empid");

-- CreateIndex
CREATE INDEX "BiometricRecord_batchID_idx" ON "BiometricRecord"("batchID");

-- CreateIndex
CREATE INDEX "MyHrSyncJob_myHrSyncId_status_idx" ON "MyHrSyncJob"("myHrSyncId", "status");

-- CreateIndex
CREATE INDEX "MyHrSyncChunk_myHrSyncJobId_status_idx" ON "MyHrSyncChunk"("myHrSyncJobId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MyHrAttendanceSync_attendanceRecordId_key" ON "MyHrAttendanceSync"("attendanceRecordId");

-- CreateIndex
CREATE INDEX "MyHrAttendanceSync_status_createdAt_idx" ON "MyHrAttendanceSync"("status", "createdAt");

-- CreateIndex
CREATE INDEX "MyHrAttendanceSync_chunkId_status_idx" ON "MyHrAttendanceSync"("chunkId", "status");

-- CreateIndex
CREATE INDEX "MyHrAttendanceSync_batchId_idx" ON "MyHrAttendanceSync"("batchId");

-- AddForeignKey
ALTER TABLE "BiometricRecord" ADD CONSTRAINT "BiometricRecord_batchID_fkey" FOREIGN KEY ("batchID") REFERENCES "MyHRBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MyHrSyncJob" ADD CONSTRAINT "MyHrSyncJob_myHrSyncId_fkey" FOREIGN KEY ("myHrSyncId") REFERENCES "MyHrSync"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MyHrSyncChunk" ADD CONSTRAINT "MyHrSyncChunk_myHrSyncJobId_fkey" FOREIGN KEY ("myHrSyncJobId") REFERENCES "MyHrSyncJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MyHrAttendanceSync" ADD CONSTRAINT "MyHrAttendanceSync_attendanceRecordId_fkey" FOREIGN KEY ("attendanceRecordId") REFERENCES "AttendanceRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MyHrAttendanceSync" ADD CONSTRAINT "MyHrAttendanceSync_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "MyHrSyncChunk"("id") ON DELETE SET NULL ON UPDATE CASCADE;
