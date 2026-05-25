-- DropForeignKey
ALTER TABLE "AttendanceRecord" DROP CONSTRAINT "AttendanceRecord_storeSyncRecordID_fkey";

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_storeSyncRecordID_fkey" FOREIGN KEY ("storeSyncRecordID") REFERENCES "StoreSyncRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
