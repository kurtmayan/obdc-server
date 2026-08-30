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
