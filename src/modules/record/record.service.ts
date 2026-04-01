import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RecordService {
  constructor(private prismaService: PrismaService) {}

  async getGeneralRecord() {
    return await this.prismaService.stores.findMany({
      include: {
        storeSyncRecords: {
          orderBy: {
            syncDate: 'desc',
          },
          take: 1,
        },
      },
    });
  }

  async getStoreRecord(id: string) {
    const storeSync = await this.prismaService.storeSyncRecord.findMany({
      where: {
        storesId: id,
      },
      include: {
        attendanceRecord: true,
      },
    });

    return storeSync.map((e) => ({
      id: e.id,
      logDate: e.syncDate,
      lastSync: e.syncDate,
      status: 'synced',
      pending: 0,
      totalRecord: e.attendanceRecord.length,
    }));
  }

  async getStoreDetailedRecord(storeId: string, syncRecordId: string) {
    return await this.prismaService.storeSyncRecord.findFirst({
      where: {
        id: syncRecordId,
        storesId: storeId,
      },
      include: {
        attendanceRecord: true,
      },
    });
  }
}
