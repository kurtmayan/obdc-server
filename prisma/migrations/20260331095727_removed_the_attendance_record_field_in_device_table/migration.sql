/*
  Warnings:

  - You are about to drop the column `devicesId` on the `AttendanceRecord` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "AttendanceRecord" DROP CONSTRAINT "AttendanceRecord_devicesId_fkey";

-- AlterTable
ALTER TABLE "AttendanceRecord" DROP COLUMN "devicesId";
