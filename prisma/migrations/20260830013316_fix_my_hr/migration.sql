/*
  Warnings:

  - You are about to drop the column `storeSyncRecordID` on the `MyHRBatch` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "MyHRBatch" DROP CONSTRAINT "MyHRBatch_storeSyncRecordID_fkey";

-- AlterTable
ALTER TABLE "MyHRBatch" DROP COLUMN "storeSyncRecordID";
