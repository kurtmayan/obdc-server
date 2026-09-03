-- Dedicated MyHR lifecycle enums keep store synchronization statuses isolated.
CREATE TYPE "MyHrTriggerSource" AS ENUM ('CRON', 'MANUAL', 'CONTINUATION');
CREATE TYPE "MyHrTriggerOutcome" AS ENUM ('CREATED', 'COALESCED', 'NO_RECORDS');
CREATE TYPE "MyHrJobStatus" AS ENUM ('PROCESSING', 'SUCCESS', 'PARTIAL_SUCCESS', 'FAILED', 'NEEDS_REVIEW');
CREATE TYPE "MyHrChunkStatus" AS ENUM ('PENDING', 'UPLOADING', 'VERIFYING', 'SUCCESS', 'FAILED', 'UNKNOWN');
CREATE TYPE "MyHrUploadAttemptStatus" AS ENUM ('PREPARED', 'REQUEST_STARTED', 'ACCEPTED', 'REJECTED', 'UNKNOWN');
CREATE TYPE "MyHrOutboxMessageType" AS ENUM ('START_MY_HR_SYNC', 'SYNC_MY_HR_CHUNK', 'CHECK_MY_HR_BATCH');
CREATE TYPE "MyHrRecordSyncStatus_new" AS ENUM ('PENDING', 'UPLOADING', 'VERIFYING', 'SYNCED', 'FAILED', 'UNKNOWN');

ALTER TABLE "MyHrSyncJob" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "MyHrSyncJob"
  ALTER COLUMN "status" TYPE "MyHrJobStatus"
  USING (
    CASE "status"::text
      WHEN 'SUCCESS' THEN 'SUCCESS'::"MyHrJobStatus"
      WHEN 'FAILED' THEN 'FAILED'::"MyHrJobStatus"
      ELSE 'PROCESSING'::"MyHrJobStatus"
    END
  );
ALTER TABLE "MyHrSyncJob" ALTER COLUMN "status" SET DEFAULT 'PROCESSING';
ALTER TABLE "MyHrSyncJob" ADD COLUMN "reviewRecords" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "MyHrSyncChunk" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "MyHrSyncChunk"
  ALTER COLUMN "status" TYPE "MyHrChunkStatus"
  USING (
    CASE
      WHEN "status"::text = 'PROCESSING' AND "batchId" IS NOT NULL THEN 'VERIFYING'::"MyHrChunkStatus"
      WHEN "status"::text = 'PROCESSING' THEN 'UNKNOWN'::"MyHrChunkStatus"
      ELSE "status"::text::"MyHrChunkStatus"
    END
  );
ALTER TABLE "MyHrSyncChunk" ALTER COLUMN "status" SET DEFAULT 'PENDING';
ALTER TABLE "MyHrSyncChunk" RENAME COLUMN "attemptCount" TO "uploadAttemptCount";
ALTER TABLE "MyHrSyncChunk" ADD COLUMN "sequence" INTEGER;
ALTER TABLE "MyHrSyncChunk" ADD COLUMN "statusCheckAttemptCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "MyHrSyncChunk" ADD COLUMN "payloadHash" TEXT;
ALTER TABLE "MyHrSyncChunk" ADD COLUMN "payloadPurgedAt" TIMESTAMP(3);
ALTER TABLE "MyHrSyncChunk" ADD COLUMN "claimToken" TEXT;
ALTER TABLE "MyHrSyncChunk" ADD COLUMN "leaseExpiresAt" TIMESTAMP(3);
ALTER TABLE "MyHrSyncChunk" ADD COLUMN "verificationDeadline" TIMESTAMP(3);

WITH ranked_chunks AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "myHrSyncJobId" ORDER BY "createdAt", "id") - 1 AS sequence
  FROM "MyHrSyncChunk"
)
UPDATE "MyHrSyncChunk" AS chunk
SET "sequence" = ranked_chunks.sequence,
    "payloadHash" = md5(chunk."payload"::text)
FROM ranked_chunks
WHERE chunk."id" = ranked_chunks."id";

ALTER TABLE "MyHrSyncChunk" ALTER COLUMN "sequence" SET NOT NULL;
ALTER TABLE "MyHrSyncChunk" ALTER COLUMN "payloadHash" SET NOT NULL;

ALTER TABLE "MyHrAttendanceSync" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "MyHrAttendanceSync"
  ALTER COLUMN "status" TYPE "MyHrRecordSyncStatus_new"
  USING (
    CASE "status"::text
      WHEN 'PROCESSING' THEN 'UPLOADING'::"MyHrRecordSyncStatus_new"
      ELSE "status"::text::"MyHrRecordSyncStatus_new"
    END
  );
DROP TYPE "MyHrRecordSyncStatus";
ALTER TYPE "MyHrRecordSyncStatus_new" RENAME TO "MyHrRecordSyncStatus";
ALTER TABLE "MyHrAttendanceSync" ALTER COLUMN "status" SET DEFAULT 'PENDING';

UPDATE "MyHrAttendanceSync" AS record
SET "status" = 'VERIFYING'
FROM "MyHrSyncChunk" AS chunk
WHERE record."chunkId" = chunk."id" AND chunk."status" = 'VERIFYING';

UPDATE "MyHrAttendanceSync" AS record
SET "status" = 'UNKNOWN'
FROM "MyHrSyncChunk" AS chunk
WHERE record."chunkId" = chunk."id" AND chunk."status" = 'UNKNOWN';

UPDATE "MyHrSyncJob" AS job
SET "status" = 'NEEDS_REVIEW',
    "errorMessage" = COALESCE(job."errorMessage", 'Migrated with an upload whose outcome is unknown')
WHERE job."status" = 'PROCESSING'
  AND EXISTS (
    SELECT 1 FROM "MyHrSyncChunk" AS chunk
    WHERE chunk."myHrSyncJobId" = job."id" AND chunk."status" = 'UNKNOWN'
  )
  AND NOT EXISTS (
    SELECT 1 FROM "MyHrSyncChunk" AS chunk
    WHERE chunk."myHrSyncJobId" = job."id" AND chunk."status" IN ('PENDING', 'VERIFYING')
  );

WITH active_jobs AS (
  SELECT "id", ROW_NUMBER() OVER (ORDER BY "createdAt", "id") AS position
  FROM "MyHrSyncJob"
  WHERE "status" = 'PROCESSING'
)
UPDATE "MyHrSyncJob" AS job
SET "status" = 'NEEDS_REVIEW',
    "errorMessage" = COALESCE(job."errorMessage", 'Multiple active jobs existed during scheduler migration')
FROM active_jobs
WHERE job."id" = active_jobs."id" AND active_jobs.position > 1;

UPDATE "MyHrSyncChunk" AS chunk
SET "status" = 'UNKNOWN',
    "completedAt" = CURRENT_TIMESTAMP,
    "errorMessage" = COALESCE(chunk."errorMessage", 'Held for review after multiple active jobs were found')
FROM "MyHrSyncJob" AS job
WHERE chunk."myHrSyncJobId" = job."id"
  AND job."status" = 'NEEDS_REVIEW'
  AND chunk."status" IN ('PENDING', 'VERIFYING');

UPDATE "MyHrAttendanceSync" AS record
SET "status" = 'UNKNOWN',
    "errorMessage" = COALESCE(record."errorMessage", 'Held for review during scheduler migration')
FROM "MyHrSyncChunk" AS chunk
WHERE record."chunkId" = chunk."id" AND chunk."status" = 'UNKNOWN'
  AND record."status" IN ('PENDING', 'VERIFYING', 'UPLOADING');

CREATE TABLE "MyHrSyncTrigger" (
  "id" TEXT NOT NULL,
  "triggerId" TEXT NOT NULL,
  "source" "MyHrTriggerSource" NOT NULL,
  "scheduledFor" TIMESTAMP(3) NOT NULL,
  "outcome" "MyHrTriggerOutcome",
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "jobId" TEXT,
  CONSTRAINT "MyHrSyncTrigger_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MyHrUploadAttempt" (
  "id" TEXT NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "status" "MyHrUploadAttemptStatus" NOT NULL DEFAULT 'PREPARED',
  "requestStartedAt" TIMESTAMP(3),
  "responseRecordedAt" TIMESTAMP(3),
  "batchId" TEXT,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "chunkId" TEXT NOT NULL,
  CONSTRAINT "MyHrUploadAttempt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MyHrOutbox" (
  "id" TEXT NOT NULL,
  "dedupKey" TEXT NOT NULL,
  "messageType" "MyHrOutboxMessageType" NOT NULL,
  "payload" JSONB NOT NULL,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "publishedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MyHrOutbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MyHrSyncTrigger_triggerId_key" ON "MyHrSyncTrigger"("triggerId");
CREATE INDEX "MyHrSyncTrigger_createdAt_idx" ON "MyHrSyncTrigger"("createdAt");
CREATE INDEX "MyHrSyncTrigger_jobId_idx" ON "MyHrSyncTrigger"("jobId");
CREATE UNIQUE INDEX "MyHrSyncChunk_myHrSyncJobId_sequence_key" ON "MyHrSyncChunk"("myHrSyncJobId", "sequence");
CREATE INDEX "MyHrSyncChunk_status_leaseExpiresAt_idx" ON "MyHrSyncChunk"("status", "leaseExpiresAt");
CREATE INDEX "MyHrSyncChunk_batchId_idx" ON "MyHrSyncChunk"("batchId");
CREATE UNIQUE INDEX "MyHrSyncJob_single_processing_key" ON "MyHrSyncJob"("status") WHERE "status" = 'PROCESSING';
CREATE UNIQUE INDEX "MyHrUploadAttempt_chunkId_attemptNumber_key" ON "MyHrUploadAttempt"("chunkId", "attemptNumber");
CREATE INDEX "MyHrUploadAttempt_status_createdAt_idx" ON "MyHrUploadAttempt"("status", "createdAt");
CREATE UNIQUE INDEX "MyHrOutbox_dedupKey_key" ON "MyHrOutbox"("dedupKey");
CREATE INDEX "MyHrOutbox_publishedAt_availableAt_idx" ON "MyHrOutbox"("publishedAt", "availableAt");
CREATE INDEX "AttendanceRecord_createdAt_id_idx" ON "AttendanceRecord"("createdAt", "id");

ALTER TABLE "MyHrSyncTrigger" ADD CONSTRAINT "MyHrSyncTrigger_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "MyHrSyncJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MyHrUploadAttempt" ADD CONSTRAINT "MyHrUploadAttempt_chunkId_fkey"
  FOREIGN KEY ("chunkId") REFERENCES "MyHrSyncChunk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Pending and verifiable legacy chunks are made recoverable through the outbox.
INSERT INTO "MyHrOutbox" (
  "id", "dedupKey", "messageType", "payload", "availableAt", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  'chunk:' || chunk."id",
  'SYNC_MY_HR_CHUNK',
  jsonb_build_object(
    'version', 1,
    'type', 'SYNC_MY_HR_CHUNK',
    'payload', jsonb_build_object('chunkId', chunk."id"),
    'createdAt', CURRENT_TIMESTAMP
  ),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "MyHrSyncChunk" AS chunk
WHERE chunk."status" = 'PENDING'
ON CONFLICT ("dedupKey") DO NOTHING;

INSERT INTO "MyHrOutbox" (
  "id", "dedupKey", "messageType", "payload", "availableAt", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  'status:' || chunk."id" || ':migration',
  'CHECK_MY_HR_BATCH',
  jsonb_build_object(
    'version', 1,
    'type', 'CHECK_MY_HR_BATCH',
    'payload', jsonb_build_object('chunkId', chunk."id", 'batchId', chunk."batchId"),
    'createdAt', CURRENT_TIMESTAMP
  ),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "MyHrSyncChunk" AS chunk
WHERE chunk."status" = 'VERIFYING' AND chunk."batchId" IS NOT NULL
ON CONFLICT ("dedupKey") DO NOTHING;
