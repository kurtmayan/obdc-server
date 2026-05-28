-- CreateTable
CREATE TABLE "SyncStatistics" (
    "id" TEXT NOT NULL,
    "totalSyncedSuccess" INTEGER NOT NULL DEFAULT 0,
    "totalSyncedFailed" INTEGER NOT NULL DEFAULT 0,
    "syncDate" DATE NOT NULL DEFAULT CURRENT_DATE,

    CONSTRAINT "SyncStatistics_pkey" PRIMARY KEY ("id")
);
