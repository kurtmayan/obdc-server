// src/queue/tasks.processor.ts
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStoreSyncRecord } from '../sync/dto/create-store-sync-record.dto';

@Processor('sync')
export class TaskProcessor extends WorkerHost {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(
    job: Job<{
      payload: CreateStoreSyncRecord;
      syncRecords: { id: string; storesId: string }[];
    }>,
  ) {
    const { payload, syncRecords } = job.data;

    const syncRecordIds = syncRecords.map((record) => record.id);

    try {
      await this.prisma.storeSyncRecord.updateMany({
        where: { id: { in: syncRecordIds } },
        data: {
          status: 'PROCESSING',
          startedAt: new Date(),
        },
      });

      const deviceIds = [
        ...new Set(payload.sync_record.map((record) => record.device_id)),
      ];

      const devices = await this.prisma.devices.findMany({
        where: {
          serialNumber: { in: deviceIds },
        },
        select: {
          serialNumber: true,
          storesId: true,
        },
      });

      const deviceMap = new Map(
        devices.map((device) => [device.serialNumber, device]),
      );

      const storeToSyncMap = new Map(
        syncRecords.map((syncRecord) => [syncRecord.storesId, syncRecord.id]),
      );

      const incomingAttendanceIds = [
        ...new Set(
          payload.sync_record.flatMap((record) =>
            record.attendance_record.map((log) => log.id),
          ),
        ),
      ];

      const existingAttendance = await this.prisma.attendanceRecord.findMany({
        where: {
          id: { in: incomingAttendanceIds },
        },
        select: { id: true },
      });

      const existingAttendanceSet = new Set(
        existingAttendance.map((record) => record.id),
      );

      const CHUNK_SIZE = 500;
      let batch: {
        id: string;
        employeeName: string;
        userId: string;
        logDate: Date;
        logType: number;
        storeSyncRecordID: string;
      }[] = [];

      const insertedCountBySyncRecord = new Map<string, number>();

      const insertBatch = async () => {
        if (batch.length === 0) return;

        const created = await this.prisma.attendanceRecord.createMany({
          data: batch,
          skipDuplicates: true,
        });

        // createMany only returns total count, not per StoreSyncRecord count
        // so this is an estimated per-sync count based on prepared batch
        for (const item of batch) {
          insertedCountBySyncRecord.set(
            item.storeSyncRecordID,
            (insertedCountBySyncRecord.get(item.storeSyncRecordID) ?? 0) + 1,
          );
        }

        batch = [];
        return created.count;
      };

      let totalInserted = 0;

      for (const record of payload.sync_record) {
        const device = deviceMap.get(record.device_id);

        if (!device) {
          throw new Error(`Device not found: ${record.device_id}`);
        }

        const syncRecordId = storeToSyncMap.get(device.storesId);

        if (!syncRecordId) {
          throw new Error(
            `Sync record not found for store: ${device.storesId}`,
          );
        }

        for (const log of record.attendance_record) {
          if (existingAttendanceSet.has(log.id)) continue;

          batch.push({
            id: log.id,
            employeeName: log.employee_name,
            userId: log.employee_id,
            logDate: new Date(log.log_date + '.000Z'),
            logType: log.punch,
            storeSyncRecordID: syncRecordId,
          });

          if (batch.length >= CHUNK_SIZE) {
            const inserted = await insertBatch();
            totalInserted += inserted ?? 0;
          }
        }
      }

      const inserted = await insertBatch();
      totalInserted += inserted ?? 0;

      await Promise.all(
        syncRecords.map((syncRecord) =>
          this.prisma.storeSyncRecord.update({
            where: { id: syncRecord.id },
            data: {
              status: 'SUCCESS',
              completedAt: new Date(),
              insertedRecords:
                insertedCountBySyncRecord.get(syncRecord.id) ?? 0,
            },
          }),
        ),
      );

      return {
        insertedRecords: totalInserted,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Unknown error occurred while syncing records';

      await this.prisma.storeSyncRecord.updateMany({
        where: { id: { in: syncRecordIds } },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          errorMessage,
        },
      });

      throw error;
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    console.log(`Job ${job.id} completed`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    console.error(`Job ${job.id} failed`, error);
  }
}
