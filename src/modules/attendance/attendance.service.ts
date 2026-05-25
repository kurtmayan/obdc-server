import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as XLSX from 'xlsx';

interface TempRecord {
  rowNumber: number;
  storeName: string;
  name: string;
  userId: string;
  logDate: Date;
  logType: number;
}

interface ValidRecord extends TempRecord {
  storeId: string;
}

@Injectable()
export class AttendanceService {
  constructor(private prismaService: PrismaService) {}

  async getAllData() {
    return await this.prismaService.storeSyncRecord.findMany({
      orderBy: {
        syncDate: 'desc',
      },
      include: {
        attendanceRecord: true,
        store: {
          include: {
            devices: true,
          },
        },
      },
    });
  }

  async getGeneralRecord() {
    return await this.prismaService.stores.findMany({
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        storeSyncRecords: {
          orderBy: {
            syncDate: 'desc',
          },
          take: 1,
        },
        devices: {
          orderBy: {
            createdAt: 'desc',
          },
          take: 1,
        },
      },
    });
  }

  async getStoreRecord(id: string) {
    const storeSync = await this.prismaService.storeSyncRecord.findMany({
      orderBy: {
        syncDate: 'desc',
      },
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
      status: e.status,
      totalRecord: e.attendanceRecord.length,
    }));
  }

  async getStoreDetailedRecord(storeId: string, syncRecordId: string) {
    return await this.prismaService.storeSyncRecord.findFirst({
      orderBy: {
        syncDate: 'desc',
      },
      where: {
        id: syncRecordId,
        storesId: storeId,
      },
      include: {
        attendanceRecord: true,
      },
    });
  }

  async importAttendanceRecords(file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    // 1. Parse xlsx from buffer (no disk I/O)
    const workbook = XLSX.read(file.buffer, {
      type: 'buffer',
      cellDates: true,
    });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet);

    const validationErrors: { row: number; reason: string }[] = [];
    const tempRecords: TempRecord[] = [];

    // 2. First pass: Basic validation without DB queries
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 2; // account for header row

      const storeName = (row['Store Name'] as string)?.toString().trim();
      const name = (row['Name'] as string)?.toString().trim();
      const userId = (row['User ID'] as string)?.toString().trim();
      const logDate = row['Log Date'] as Date;
      const logType = (row['Log Type'] as string)?.toString().trim();

      // Basic validation
      if (!storeName || !name || !userId) {
        validationErrors.push({
          row: rowNumber,
          reason: 'Missing required fields',
        });
        continue;
      }

      if (!logDate) {
        validationErrors.push({ row: rowNumber, reason: 'Missing Log Date' });
        continue;
      }

      if (!logType || isNaN(parseInt(logType))) {
        validationErrors.push({ row: rowNumber, reason: 'Invalid Log Type' });
        continue;
      }

      // Store temporarily for batch store lookup
      tempRecords.push({
        rowNumber,
        storeName,
        name,
        userId,
        logDate: new Date(logDate),
        logType: parseInt(logType),
      });
    }

    // 3. Batch check all stores at once (single DB query)
    const uniqueStoreNames = [...new Set(tempRecords.map((r) => r.storeName))];
    const stores = await this.prismaService.stores.findMany({
      where: {
        name: { in: uniqueStoreNames },
      },
    });

    const storeMap = new Map(stores.map((s) => [s.name, s]));

    // 4. Validate store references
    const validRecords: ValidRecord[] = [];
    for (const record of tempRecords) {
      const store = storeMap.get(record.storeName);
      if (!store) {
        validationErrors.push({
          row: record.rowNumber,
          reason: `Store "${record.storeName}" not found`,
        });
        continue;
      }

      validRecords.push({
        ...record,
        storeId: store.id,
      });
    }

    // 3. If there are validation errors, throw them all at once
    if (validationErrors.length > 0) {
      throw new BadRequestException({
        message: 'Validation errors found in file',
        errors: validationErrors,
      });
    }

    // 4. Second pass: Create StoreSyncRecords and AttendanceRecords
    const inserted: ValidRecord[] = [];
    const storeRecordMap = new Map<string, string>(); // Map storeId to syncRecordId

    for (const record of validRecords) {
      let syncRecordId = storeRecordMap.get(record.storeId);

      // Create StoreSyncRecord if not already created for this store
      if (!syncRecordId) {
        const syncRecord = await this.prismaService.storeSyncRecord.create({
          data: {
            storesId: record.storeId,
          },
        });
        syncRecordId = syncRecord.id;
        storeRecordMap.set(record.storeId, syncRecordId);
      }

      // Insert attendance record
      await this.prismaService.attendanceRecord.create({
        data: {
          employeeName: record.name,
          userId: record.userId,
          logDate: record.logDate,
          logType: record.logType,
          storeSyncRecordID: syncRecordId,
        },
      });

      inserted.push(record);
    }

    return {
      message: 'Import complete',
      inserted: inserted.length,
      skipped: validationErrors.length,
      skippedDetails: validationErrors,
    };
  }
}
