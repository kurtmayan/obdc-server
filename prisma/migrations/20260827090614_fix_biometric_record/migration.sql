/*
  Warnings:

  - You are about to drop the column `createdAt` on the `BiometricRecord` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `BiometricRecord` table. All the data in the column will be lost.
  - Changed the type of `logstats` on the `BiometricRecord` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Added the required column `updatedAt` to the `MyHRBatch` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "BiometricRecord" DROP COLUMN "createdAt",
DROP COLUMN "updatedAt",
DROP COLUMN "logstats",
ADD COLUMN     "logstats" BOOLEAN NOT NULL;

-- AlterTable
ALTER TABLE "MyHRBatch" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;
