/*
  Warnings:

  - You are about to drop the column `totalSyncedFailed` on the `SyncStatistics` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "SyncStatistics" DROP COLUMN "totalSyncedFailed";
