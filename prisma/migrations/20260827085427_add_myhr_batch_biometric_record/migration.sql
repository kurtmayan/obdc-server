-- CreateTable
CREATE TABLE "BiometricRecord" (
    "id" TEXT NOT NULL,
    "empid" TEXT NOT NULL,
    "logdt" TEXT NOT NULL,
    "logtm" TEXT NOT NULL,
    "logstats" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "batchID" TEXT NOT NULL,

    CONSTRAINT "BiometricRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MyHRBatch" (
    "id" TEXT NOT NULL,
    "storeSyncRecordID" TEXT NOT NULL,

    CONSTRAINT "MyHRBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BiometricRecord_empid_idx" ON "BiometricRecord"("empid");

-- CreateIndex
CREATE INDEX "BiometricRecord_batchID_idx" ON "BiometricRecord"("batchID");

-- AddForeignKey
ALTER TABLE "BiometricRecord" ADD CONSTRAINT "BiometricRecord_batchID_fkey" FOREIGN KEY ("batchID") REFERENCES "MyHRBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MyHRBatch" ADD CONSTRAINT "MyHRBatch_storeSyncRecordID_fkey" FOREIGN KEY ("storeSyncRecordID") REFERENCES "StoreSyncRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
