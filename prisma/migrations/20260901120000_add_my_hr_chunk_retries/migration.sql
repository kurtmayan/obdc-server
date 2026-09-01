-- Track delivery attempts so transient MyHR failures can be retried safely.
ALTER TABLE "MyHrSyncChunk"
ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0;
