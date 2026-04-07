/*
  Warnings:

  - Added the required column `userId` to the `AttendanceRecord` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "AttendanceRecord" ADD COLUMN     "userId" TEXT NOT NULL;
