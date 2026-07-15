-- CreateTable
CREATE TABLE "StoreSyncRecordChunk" (
    "id" TEXT NOT NULL,
    "storeSyncRecordID" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "status" "SyncStatus" NOT NULL DEFAULT 'PENDING',
    "totalRecords" INTEGER NOT NULL DEFAULT 0,
    "insertedRecords" INTEGER NOT NULL DEFAULT 0,
    "failedRecords" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB NOT NULL,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreSyncRecordChunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StoreSyncRecordChunk_storeSyncRecordID_chunkIndex_key" ON "StoreSyncRecordChunk"("storeSyncRecordID", "chunkIndex");

-- CreateIndex
CREATE INDEX "StoreSyncRecordChunk_status_idx" ON "StoreSyncRecordChunk"("status");

-- CreateIndex
CREATE INDEX "StoreSyncRecordChunk_storeSyncRecordID_status_idx" ON "StoreSyncRecordChunk"("storeSyncRecordID", "status");

-- AddForeignKey
ALTER TABLE "StoreSyncRecordChunk" ADD CONSTRAINT "StoreSyncRecordChunk_storeSyncRecordID_fkey" FOREIGN KEY ("storeSyncRecordID") REFERENCES "StoreSyncRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
