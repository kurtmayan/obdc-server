/*
  Warnings:

  - You are about to drop the `MyHRRecord` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `MyHRRecordChunk` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "MyHRRecord" DROP CONSTRAINT "MyHRRecord_storesId_fkey";

-- DropForeignKey
ALTER TABLE "MyHRRecordChunk" DROP CONSTRAINT "MyHRRecordChunk_myHRRecordID_fkey";

-- DropTable
DROP TABLE "MyHRRecord";

-- DropTable
DROP TABLE "MyHRRecordChunk";
