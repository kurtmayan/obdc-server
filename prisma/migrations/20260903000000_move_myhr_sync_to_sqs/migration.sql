-- Support the hourly MyHR queue workflow's active-job lookup.
CREATE INDEX "MyHrSyncJob_status_startedAt_idx" ON "MyHrSyncJob"("status", "startedAt");

-- Support ordered scans when preparing bounded MyHR attendance sync jobs.
CREATE INDEX "AttendanceRecord_createdAt_id_idx" ON "AttendanceRecord"("createdAt", "id");
