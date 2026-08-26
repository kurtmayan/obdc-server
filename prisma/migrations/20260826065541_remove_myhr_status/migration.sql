/*
  Warnings:

  - The `status` column on the `MyHRRecord` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `status` column on the `MyHRRecordChunk` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "MyHRRecord" DROP COLUMN "status",
ADD COLUMN     "status" "SyncStatus" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "MyHRRecordChunk" DROP COLUMN "status",
ADD COLUMN     "status" "SyncStatus" NOT NULL DEFAULT 'PENDING';

-- DropEnum
DROP TYPE "MyHRStatus";

-- CreateIndex
CREATE INDEX "MyHRRecordChunk_status_idx" ON "MyHRRecordChunk"("status");

-- CreateIndex
CREATE INDEX "MyHRRecordChunk_myHRRecordID_status_idx" ON "MyHRRecordChunk"("myHRRecordID", "status");
