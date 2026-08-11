-- CreateIndex
CREATE INDEX "StoreSyncRecord_storesId_syncDate_idx" ON "StoreSyncRecord"("storesId", "syncDate" DESC);
