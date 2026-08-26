/*
  Warnings:

  - You are about to drop the `BiometricRecord` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "BiometricRecord" DROP CONSTRAINT "BiometricRecord_myHRRecordID_fkey";

-- DropTable
DROP TABLE "BiometricRecord";
