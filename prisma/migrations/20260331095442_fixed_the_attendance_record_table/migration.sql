/*
  Warnings:

  - You are about to drop the column `timeIn` on the `AttendanceRecord` table. All the data in the column will be lost.
  - You are about to drop the column `timeOut` on the `AttendanceRecord` table. All the data in the column will be lost.
  - Added the required column `logDate` to the `AttendanceRecord` table without a default value. This is not possible if the table is not empty.
  - Added the required column `logType` to the `AttendanceRecord` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "LogType" AS ENUM ('timeIn', 'timeOut');

-- AlterTable
ALTER TABLE "AttendanceRecord" DROP COLUMN "timeIn",
DROP COLUMN "timeOut",
ADD COLUMN     "logDate" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "logType" "LogType" NOT NULL;
