import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStoreSyncRecord } from './dto/create-store-sync-record.dto';
import * as ExcelJS from 'exceljs';
import { exportParseDateTime, parseDateTime } from 'src/lib/formatDate';

@Injectable()
export class SyncService {
  constructor(private readonly prisma: PrismaService) {}

  private logger = new Logger(SyncService.name);

  async storeSyncRecord(payload: CreateStoreSyncRecord) {
    const device_ids = payload.sync_record.map((r) => r.device_id);

    const attendance = await this.prisma.attendanceRecord.findMany({
      where: {
        storeSyncRecords: {
          store: {
            devices: {
              some: {
                serialNumber: {
                  in: device_ids,
                },
              },
            },
          },
        },
      },
      select: {
        id: true,
      },
    });

    const syncedDataSet = new Set(attendance.map((record) => record.id));

    const devices = await this.prisma.devices.findMany({
      where: {
        serialNumber: {
          in: device_ids,
        },
      },
      select: {
        id: true,
        serialNumber: true,
        storesId: true,
      },
    });

    if (devices.length === 0) {
      throw new NotFoundException('No devices found!');
    }

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const uniqueStoreIds = [...new Set(devices.map((d) => d.storesId))];

        const storeSyncRecords = await Promise.all(
          uniqueStoreIds.map((storesId) =>
            tx.storeSyncRecord.create({
              data: { storesId },
            }),
          ),
        );

        const storeToSyncMap = new Map(
          uniqueStoreIds.map((storeId, index) => [
            storeId,
            storeSyncRecords[index].id,
          ]),
        );

        const deviceToSyncMap = new Map(
          devices.map((device) => [
            device.serialNumber,
            storeToSyncMap.get(device.storesId),
          ]),
        );

        const transformedData = payload.sync_record.flatMap((record) => {
          const syncId = deviceToSyncMap.get(record.device_id);

          if (!syncId) {
            throw new BadRequestException(
              `Device not found: ${record.device_id}`,
            );
          }

          return record.attendance_record
            .filter((log) => !syncedDataSet.has(log.id))
            .map((log) => ({
              employeeName: log.employee_name,
              userId: log.employee_id,
              logDate: new Date(log.log_date),
              logType: log.punch,
              storeSyncRecordID: syncId,
              id: log.id,
            }));
        });

        const CHUNK_SIZE = 500;
        const chunks = Array.from(
          { length: Math.ceil(transformedData.length / CHUNK_SIZE) },
          (_, i) => transformedData.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
        );

        const results = await Promise.all(
          chunks.map((chunk) =>
            tx.attendanceRecord.createMany({ data: chunk }),
          ),
        );

        const totalCount = results.reduce((sum, r) => sum + r.count, 0);

        return { totalCount };
      });

      this.logger.log(`Inserted ${result.totalCount} attendance records`);

      return {
        success: true,
        message: 'Record Synced',
        data: { count: result.totalCount },
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }

      this.logger.error(
        'Failed to sync records, transaction rolled back',
        error,
      );

      throw new UnprocessableEntityException(
        "There's an error while saving records in the database!",
      );
    }
  }

  async export(startDate?: string, endDate?: string, format: string = 'xlsx') {
    return this.generateExport(startDate, endDate, format);
  }

  private async generateExport(
    startDate?: string,
    endDate?: string,
    format: string = 'xlsx',
  ) {
    // Parse dates properly - create date at midnight UTC
    const start = startDate
      ? new Date(`${startDate}T00:00:00.000Z`)
      : new Date(0);

    const end = endDate ? new Date(`${endDate}T23:59:59.999Z`) : new Date();

    const attendanceRecords = await this.prisma.attendanceRecord.findMany({
      where: {
        logDate: {
          gte: start,
          lte: end,
        },
      },
      include: {
        storeSyncRecords: {
          include: {
            store: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });

    // Transform records to common format
    const transformedData = attendanceRecords.map((record) => {
      const { date, time } = parseDateTime(record.logDate);
      return {
        employeeID: String(record.userId),
        logDate: date,
        logTime: `${date} ${time}`,
        status: record.logType === 0 ? '1' : '0',
        location: record.storeSyncRecords.store.name,
      };
    });

    // Export based on format
    if (format === 'csv') {
      return this.exportAsCSV(transformedData);
    } else {
      return this.exportAsExcel(transformedData);
    }
  }

  private exportAsCSV(data: any[]): Buffer {
    const headers = ['EMPID', 'Log Date', 'Log Time', 'Status', 'Location'];
    const rows = [headers];

    data.forEach((record) => {
      rows.push([
        record.employeeID,
        record.logDate,
        record.logTime,
        record.status,
        record.location,
      ]);
    });

    const csvContent = rows
      .map((row) => row.map((cell) => `"${cell}"`).join(','))
      .join('\n');

    return Buffer.from(csvContent, 'utf-8');
  }

  private async exportAsExcel(data: any[]): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');

    sheet.columns = [
      { header: 'EMPID', key: 'employeeID' },
      { header: 'Log Date', key: 'logDate' },
      { header: 'Log Time', key: 'logTime' },
      { header: 'Status', key: 'status' },
      { header: 'Location', key: 'location' },
    ];

    if (data.length === 0) {
      const buffer = await workbook.xlsx.writeBuffer();
      return Buffer.from(buffer);
    }

    const columnWidths = [10, 10, 10, 10, 10];

    data.forEach((record) => {
      sheet.addRow(record);

      // Track max column widths for better formatting
      Object.values(record).forEach((value, index) => {
        const length = String(value).length + 2;
        columnWidths[index] = Math.min(
          Math.max(columnWidths[index], length),
          50,
        );
      });
    });

    // Format header row
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' },
      };
    });

    // Apply optimized column widths
    sheet.columns.forEach((column, index) => {
      column.width = columnWidths[index];
    });

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }
}
