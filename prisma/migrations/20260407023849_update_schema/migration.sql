/*
  Warnings:

  - Changed the type of `logType` on the `AttendanceRecord` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- AlterTable
ALTER TABLE "AttendanceRecord" DROP COLUMN "logType",
ADD COLUMN     "logType" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "Stores" ADD COLUMN     "code" TEXT;

-- DropEnum
DROP TYPE "LogType";
