-- DropForeignKey
ALTER TABLE "Devices" DROP CONSTRAINT "Devices_storesId_fkey";

-- DropForeignKey
ALTER TABLE "StoreSyncRecord" DROP CONSTRAINT "StoreSyncRecord_storesId_fkey";

-- AddForeignKey
ALTER TABLE "Devices" ADD CONSTRAINT "Devices_storesId_fkey" FOREIGN KEY ("storesId") REFERENCES "Stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreSyncRecord" ADD CONSTRAINT "StoreSyncRecord_storesId_fkey" FOREIGN KEY ("storesId") REFERENCES "Stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
