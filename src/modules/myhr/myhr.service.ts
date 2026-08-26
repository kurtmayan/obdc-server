import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateMyHrRecord, MyHrRecordDto } from './dto/create-myhr.dto';
import { PrismaService } from '../prisma/prisma.service';
import { Status, SyncStatus } from 'src/generated/prisma/enums';
import { Prisma } from 'src/generated/prisma/client';
import { SqsQueueService } from '../sqs-queue/sqs-queue.service';
import { StoreSyncRecordGetPayload, StoreSyncRecordSelect } from 'src/generated/prisma/models';

const storeSyncRecordSelect = {
  id: true,
  storesId: true,
  status: true,
} as const satisfies StoreSyncRecordSelect;

type QueuedStoreSyncRecord = StoreSyncRecordGetPayload<{
  select: typeof storeSyncRecordSelect;
}>;

const SYNC_CHUNK_BIOMETRIC_RECORD_LIMIT = 500;

@Injectable()
export class MyHrService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sqsQueueService: SqsQueueService,
  ) {}

  async storeMyHrRecords(payload: CreateMyHrRecord) {
    const deviceIds = [
      ...new Set(payload.sync_record.map((record) => record.device_id)),
    ];

    if (deviceIds.length === 0) {
      throw new BadRequestException('No devices provided!');
    }

    const devices = await this.prisma.devices.findMany({
      where: {
        serialNumber: { in: deviceIds },
      },
      select: {
        id: true,
        serialNumber: true,
        storesId: true,
        store: {
          select: {
            name: true,
            status: true,
          },
        },
      },
    });

    if (devices.length === 0) {
      throw new NotFoundException('No devices found!');
    }

    const deviceMap = new Map(
      devices.map((device) => [device.serialNumber, device]),
    );

    const missingDevices = deviceIds.filter(
      (deviceId) => !deviceMap.has(deviceId),
    );

    if (missingDevices.length > 0) {
      throw new BadRequestException(
        `Device not found: ${missingDevices.join(', ')}`,
      );
    }

    const inactiveStoreNames = [
      ...new Set(
        devices
          .filter((device) => device.store.status !== Status.active)
          .map((device) => device.store.name),
      ),
    ];

    if (inactiveStoreNames.length > 0) {
      throw new BadRequestException(
        `Inactive stores: ${inactiveStoreNames.join(', ')}`,
      );
    }

    const recordsByStore = new Map<string, MyHrRecordDto[]>();

    for (const record of payload.sync_record) {
      const device = deviceMap.get(record.device_id);

      if (!device) {
        throw new BadRequestException(`Device not found: ${record.device_id}`);
      }

      const storeRecords = recordsByStore.get(device.storesId) ?? [];
      storeRecords.push(record);
      recordsByStore.set(device.storesId, storeRecords);
    }

    const syncRecords: QueuedStoreSyncRecord[] = [];
    const chunkIds: string[] = [];

    for (const [storesId, storeRecords] of recordsByStore) {
      const storePayload: CreateMyHrRecord = {
        sync_record: storeRecords
      };

      const chunks = this.chunkSyncPayload(storePayload);
      const totalRecords = this.countBiometricRecords(storePayload);

      const syncRecord = await this.prisma.storeSyncRecord.create({
        data: {
          storesId,
          status: SyncStatus.PENDING,
          totalRecords,
        },
        select: storeSyncRecordSelect,
      });

      syncRecords.push(syncRecord);

      for (const [chunkIndex, chunkPayload] of chunks.entries()) {
        const chunk = await this.prisma.storeSyncRecordChunk.create({
          data: {
            storeSyncRecordID: syncRecord.id,
            chunkIndex,
            status: SyncStatus.PENDING,
            totalRecords: this.countBiometricRecords(chunkPayload),
            payload: chunkPayload as unknown as Prisma.InputJsonValue,
          },
          select: {
            id: true,
          },
        });

        chunkIds.push(chunk.id);
      }
    }

    await Promise.all(
      chunkIds.map((chunkId) =>
        this.sqsQueueService.sendMessage({
          type: 'SYNC_MY_HR_CHUNK',
          payload: {
            chunkId,
          },
          createdAt: new Date().toISOString(),
        }),
      ),
    );

    return {
      success: true,
      message: 'Sync queued',
      data: {
        syncRecords,
      },
    };
  } 

  private chunkSyncPayload(
    payload: CreateMyHrRecord,
  ): CreateMyHrRecord[] {
    const chunks: CreateMyHrRecord[] = [];
    let currentRecords: MyHrRecordDto[] = [];
    let currentBiometricCount = 0;

    const flushChunk = () => {
      if (currentRecords.length === 0) {
        return;
      }

      chunks.push({
        sync_record: currentRecords
      });

      currentRecords = [];
      currentBiometricCount = 0;
    };

    for (const record of payload.sync_record) {
      if (record.biometric_record.length === 0) {
        currentRecords.push({
          device_id: record.device_id,
          biometric_record: [],
        });
        continue;
      }

      let offset = 0;

      while (offset < record.biometric_record.length) {
        const remainingCapacity =
          SYNC_CHUNK_BIOMETRIC_RECORD_LIMIT - currentBiometricCount;

        if (remainingCapacity === 0) {
          flushChunk();
          continue;
        }

        const biometricSlice = record.biometric_record.slice(
          offset,
          offset + remainingCapacity,
        );

        currentRecords.push({
          device_id: record.device_id,
          biometric_record: biometricSlice,
        });

        currentBiometricCount += biometricSlice.length;
        offset += biometricSlice.length;

        if (currentBiometricCount >= SYNC_CHUNK_BIOMETRIC_RECORD_LIMIT) {
          flushChunk();
        }
      }
    }

    flushChunk();

    return chunks.length > 0 ? chunks : [{ sync_record: [] }];
  }

  private countBiometricRecords(payload: CreateMyHrRecord): number {
    return payload.sync_record.reduce(
      (count, record) => count + record.biometric_record.length,
      0,
    );
  }
}
