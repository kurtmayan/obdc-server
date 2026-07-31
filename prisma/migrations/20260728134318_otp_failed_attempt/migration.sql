-- AlterTable
ALTER TABLE "Users" ADD COLUMN     "otpFailedAttempts" INTEGER NOT NULL DEFAULT 0;
