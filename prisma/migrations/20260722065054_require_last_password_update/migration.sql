/*
  Warnings:

  - Made the column `lastPasswordUpdate` on table `Users` required. This step will fail if there are existing NULL values in that column.

*/
UPDATE "Users"
SET "lastPasswordUpdate" = CURRENT_TIMESTAMP
WHERE "lastPasswordUpdate" IS NULL;
-- AlterTable
ALTER TABLE "Users" ALTER COLUMN "lastPasswordUpdate" SET NOT NULL,
ALTER COLUMN "lastPasswordUpdate" SET DEFAULT CURRENT_TIMESTAMP;
