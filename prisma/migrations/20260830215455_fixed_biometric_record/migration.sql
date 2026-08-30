/*
  Warnings:

  - Changed the type of `logstats` on the `BiometricRecord` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- AlterTable
ALTER TABLE "BiometricRecord" DROP COLUMN "logstats",
ADD COLUMN     "logstats" INTEGER NOT NULL;
