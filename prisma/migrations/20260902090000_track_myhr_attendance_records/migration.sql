CREATE TYPE "MyHrRecordSyncStatus" AS ENUM ('PENDING', 'PROCESSING', 'SYNCED', 'FAILED');

CREATE TABLE "MyHrAttendanceSync" (
    "id" TEXT NOT NULL,
    "attendanceRecordId" TEXT NOT NULL,
    "status" "MyHrRecordSyncStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "batchId" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "chunkId" TEXT,

    CONSTRAINT "MyHrAttendanceSync_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MyHrAttendanceSync_attendanceRecordId_key"
ON "MyHrAttendanceSync"("attendanceRecordId");
CREATE INDEX "MyHrAttendanceSync_status_createdAt_idx"
ON "MyHrAttendanceSync"("status", "createdAt");
CREATE INDEX "MyHrAttendanceSync_chunkId_status_idx"
ON "MyHrAttendanceSync"("chunkId", "status");
CREATE INDEX "MyHrAttendanceSync_batchId_idx"
ON "MyHrAttendanceSync"("batchId");

ALTER TABLE "MyHrAttendanceSync"
ADD CONSTRAINT "MyHrAttendanceSync_attendanceRecordId_fkey"
FOREIGN KEY ("attendanceRecordId") REFERENCES "AttendanceRecord"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MyHrAttendanceSync"
ADD CONSTRAINT "MyHrAttendanceSync_chunkId_fkey"
FOREIGN KEY ("chunkId") REFERENCES "MyHrSyncChunk"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- Preserve the old cursor's known-successful range before removing it. The
-- external batch ID is unavailable for historical records, but their delivery
-- state is known and they must not be uploaded again.
INSERT INTO "MyHrAttendanceSync" (
    "id", "attendanceRecordId", "status", "syncedAt", "createdAt", "updatedAt"
)
SELECT
    md5('myhr-attendance-sync:' || attendance."id"),
    attendance."id",
    'SYNCED'::"MyHrRecordSyncStatus",
    sync."lastSyncedAt",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "AttendanceRecord" AS attendance
CROSS JOIN LATERAL (
    SELECT "lastSyncedAt", "lastRecordId"
    FROM "MyHrSync"
    WHERE "lastSyncedAt" IS NOT NULL
    ORDER BY "updatedAt" DESC
    LIMIT 1
) AS sync
WHERE attendance."createdAt" < sync."lastSyncedAt"
   OR (
       attendance."createdAt" = sync."lastSyncedAt"
       AND attendance."id" <= COALESCE(sync."lastRecordId", '')
   );

-- The sync row now groups jobs only; record state above is authoritative.
ALTER TABLE "MyHrSync"
DROP COLUMN "lastSyncedAt",
DROP COLUMN "lastRecordId";
