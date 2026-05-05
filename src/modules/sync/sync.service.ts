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

  async export(startDate?: string, endDate?: string) {
    const start = startDate ? new Date(startDate) : new Date(0);
    start.setUTCHours(0, 0, 0, 0); // ✅ 12:00 AM start of day

    const end = endDate ? new Date(endDate) : new Date();
    end.setUTCHours(23, 59, 59, 999); // ✅ 11:59 PM end of day

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');

    sheet.columns = [
      { header: 'EMPID', key: 'employeeID' },
      { header: 'Log Date', key: 'logDate' },
      { header: 'Log Time', key: 'logTime' },
      { header: 'Status', key: 'status' },
      { header: 'Location', key: 'location' },
    ];

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
            store: true,
          },
        },
      },
    });

    if (!attendanceRecords.length) {
      const buffer = await workbook.xlsx.writeBuffer();
      return Buffer.from(buffer);
    }

    const transformedAttendanceRecord = attendanceRecords.map((record) => {
      const { date, time } = exportParseDateTime(record.logDate);
      return {
        employeeID: record.userId,
        logDate: date,
        logTime: `${date} ${time}`,
        status: record.logType == 0 ? '1' : record.logType == 1 ? '0' : '0',
        location: record.storeSyncRecords.store.name,
      };
    });

    for (const rowData of transformedAttendanceRecord) {
      sheet.addRow(rowData);
    }

    sheet.getRow(1).eachCell((cell) => {
      cell.font = { bold: true };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' },
      };
    });

    sheet.columns.forEach((column) => {
      let maxLength = 10;
      if (column.eachCell) {
        column.eachCell({ includeEmpty: true }, (cell) => {
          const cellValue = cell.value ? cell.value.toString() : '';
          maxLength = Math.max(maxLength, cellValue.length + 2);
        });
      }
      column.width = Math.min(maxLength, 50);
    });

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }
}
