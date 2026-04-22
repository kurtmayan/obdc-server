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

  async storeSyncRecord(data: CreateStoreSyncRecord) {
    const device = await this.prisma.devices.findFirst({
      where: {
        serialNumber: data['device-id'],
      },
      select: {
        store: true,
      },
    });

    if (!device) throw new NotFoundException();

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const storeSyncRecord = await tx.storeSyncRecord.create({
          data: {
            storesId: device.store.id,
          },
        });

        const transformedData = data.attendance.map((log) => ({
          employeeName: log.employee_name,
          userId: log.employee_id,
          logDate: new Date(log.log_date),
          logType: log.punch,
          storeSyncRecordID: storeSyncRecord.id,
        }));

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

        return { storeSyncRecord, totalCount };
      });

      this.logger.log(`Inserted ${result.totalCount} attendance records`);

      return {
        success: true,
        message: 'Record Synced',
        data: { count: result.totalCount },
      };
    } catch (error) {
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
    start.setHours(0, 0, 0, 0); // ✅ 12:00 AM start of day

    const end = endDate ? new Date(endDate) : new Date();
    end.setHours(23, 59, 59, 999); // ✅ 11:59 PM end of day

    console.log(
      'Querying from:',
      start.toISOString(),
      'to:',
      end.toISOString(),
    );

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
        createdAt: {
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
      throw new NotFoundException('No attendance records found');
    }

    const transformedAttendanceRecord = attendanceRecords.map((record) => {
      console.log('=====================');
      console.log(record);
      console.log('=====================');
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
