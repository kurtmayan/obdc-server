/*
  Warnings:

  - You are about to drop the column `barangay` on the `Stores` table. All the data in the column will be lost.
  - You are about to drop the column `contactInfo` on the `Stores` table. All the data in the column will be lost.
  - You are about to drop the column `exactAddress` on the `Stores` table. All the data in the column will be lost.
  - You are about to drop the column `municipality` on the `Stores` table. All the data in the column will be lost.
  - You are about to drop the column `province` on the `Stores` table. All the data in the column will be lost.
  - You are about to drop the column `region` on the `Stores` table. All the data in the column will be lost.
  - Added the required column `cluster` to the `Stores` table without a default value. This is not possible if the table is not empty.
  - Added the required column `contactNumber` to the `Stores` table without a default value. This is not possible if the table is not empty.
  - Added the required column `contactPerson` to the `Stores` table without a default value. This is not possible if the table is not empty.
  - Added the required column `division` to the `Stores` table without a default value. This is not possible if the table is not empty.
  - Added the required column `location` to the `Stores` table without a default value. This is not possible if the table is not empty.
  - Added the required column `status` to the `Stores` table without a default value. This is not possible if the table is not empty.
  - Made the column `code` on table `Stores` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "Division" AS ENUM ('rtm_operations', 'head_office', 'warehouse');

-- CreateEnum
CREATE TYPE "Cluster" AS ENUM ('mindanao_1', 'mindanao_2', 'visayas_2', 'ncr_north_east', 'ncr_south_calapa', 'south_luzon', 'north_central_luzon', 'head_office', 'warehouse');

-- CreateEnum
CREATE TYPE "Status" AS ENUM ('active', 'inactive');

-- AlterTable
ALTER TABLE "Stores" DROP COLUMN "barangay",
DROP COLUMN "contactInfo",
DROP COLUMN "exactAddress",
DROP COLUMN "municipality",
DROP COLUMN "province",
DROP COLUMN "region",
ADD COLUMN     "cluster" "Cluster" NOT NULL,
ADD COLUMN     "contactNumber" TEXT NOT NULL,
ADD COLUMN     "contactPerson" TEXT NOT NULL,
ADD COLUMN     "division" "Division" NOT NULL,
ADD COLUMN     "location" TEXT NOT NULL,
ADD COLUMN     "status" "Status" NOT NULL,
ALTER COLUMN "code" SET NOT NULL;
