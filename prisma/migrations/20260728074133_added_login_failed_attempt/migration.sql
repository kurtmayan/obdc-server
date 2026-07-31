-- AlterTable
ALTER TABLE "Users" ADD COLUMN     "loginFailedAttempts" INTEGER NOT NULL DEFAULT 0;
