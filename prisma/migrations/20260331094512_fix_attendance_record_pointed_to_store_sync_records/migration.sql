/*
  Warnings:

  - You are about to drop the column `attendanceRecordId` on the `StoreSyncRecord` table. All the data in the column will be lost.
  - Added the required column `storeSyncRecordID` to the `AttendanceRecord` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "StoreSyncRecord" DROP CONSTRAINT "StoreSyncRecord_attendanceRecordId_fkey";

-- AlterTable
ALTER TABLE "AttendanceRecord" ADD COLUMN     "storeSyncRecordID" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "StoreSyncRecord" DROP COLUMN "attendanceRecordId";

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_storeSyncRecordID_fkey" FOREIGN KEY ("storeSyncRecordID") REFERENCES "StoreSyncRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
