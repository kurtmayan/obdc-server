/*
  Warnings:

  - A unique constraint covering the columns `[syncDate]` on the table `SyncStatistics` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "SyncStatistics_syncDate_key" ON "SyncStatistics"("syncDate");
