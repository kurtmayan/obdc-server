import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as XLSX from 'xlsx';
import { Prisma } from 'src/generated/prisma/client';
import { FindGeneralRecordDto } from './dto/find-general-record.dto';

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

type StoreIdRow = {
  id: string;
};

type CountRow = {
  count: bigint;
};

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

  async getGeneralRecord({
    page,
    pageSize,
    q,
    division,
    cluster,
    status,
    startDate,
    endDate,
  }: FindGeneralRecordDto) {
    const take = pageSize;
    const skip = (page - 1) * take;
    const where = this.buildGeneralRecordWhere({
      q,
      division,
      cluster,
      status,
      startDate,
      endDate,
    });

    const baseQuery = Prisma.sql`
      FROM "Stores" s
      LEFT JOIN LATERAL (
        SELECT ssr."id", ssr."status", ssr."syncDate"
        FROM "StoreSyncRecord" ssr
        WHERE ssr."storesId" = s."id"
        ORDER BY ssr."syncDate" DESC
        LIMIT 1
      ) latest ON true
      ${where}
    `;

    const [storeIdRows, countRows] = await this.prismaService.$transaction([
      this.prismaService.$queryRaw<StoreIdRow[]>(Prisma.sql`
        SELECT s."id"
        ${baseQuery}
        ORDER BY s."createdAt" DESC
        OFFSET ${skip}
        LIMIT ${take}
      `),
      this.prismaService.$queryRaw<CountRow[]>(Prisma.sql`
        SELECT COUNT(*)::bigint AS count
        ${baseQuery}
      `),
    ]);

    const storeIds = storeIdRows.map(({ id }) => id);
    const count = Number(countRows[0]?.count ?? 0);

    const stores = storeIds.length
      ? await this.prismaService.stores.findMany({
          where: {
            id: {
              in: storeIds,
            },
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
        })
      : [];

    const storeById = new Map(stores.map((store) => [store.id, store]));
    const items = storeIds
      .map((id) => storeById.get(id))
      .filter((store): store is (typeof stores)[number] => Boolean(store));

    return {
      items,
      page,
      pageSize: take,
      totalItems: count,
      totalPages: Math.ceil(count / take),
    };
  }

  private buildGeneralRecordWhere({
    q,
    division,
    cluster,
    status,
    startDate,
    endDate,
  }: Pick<
    FindGeneralRecordDto,
    'q' | 'division' | 'cluster' | 'status' | 'startDate' | 'endDate'
  >) {
    const conditions: Prisma.Sql[] = [];
    const search = q?.trim();

    if (search) {
      const term = `%${search}%`;
      conditions.push(Prisma.sql`
        (
          s."name" ILIKE ${term}
          OR s."location" ILIKE ${term}
          OR s."code" ILIKE ${term}
        )
      `);
    }

    if (division) {
      conditions.push(Prisma.sql`s."division" = ${division}::"Division"`);
    }

    if (cluster) {
      conditions.push(Prisma.sql`s."cluster" = ${cluster}::"Cluster"`);
    }

    if (status) {
      conditions.push(Prisma.sql`latest."status" = ${status}::"SyncStatus"`);
    }

    if (startDate) {
      conditions.push(
        Prisma.sql`latest."syncDate" >= ${this.toStartOfDay(startDate)}`,
      );
    }

    if (endDate) {
      conditions.push(
        Prisma.sql`latest."syncDate" <= ${this.toEndOfDay(endDate)}`,
      );
    }

    if (conditions.length === 0) {
      return Prisma.empty;
    }

    return Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
  }

  private toStartOfDay(value: string) {
    const date = new Date(value);
    date.setUTCHours(0, 0, 0, 0);
    return date;
  }

  private toEndOfDay(value: string) {
    const date = new Date(value);
    date.setUTCHours(23, 59, 59, 999);
    return date;
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
    const records = await this.prismaService.storeSyncRecord.findFirst({
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

    return records;
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
