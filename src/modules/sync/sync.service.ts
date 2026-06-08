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
import { parseDateTime } from 'src/lib/formatDate';
import { QueueService } from '../queue/queue.service';
import { formatInTimeZone } from 'date-fns-tz';

@Injectable()
export class SyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
  ) {}

  private logger = new Logger(SyncService.name);

  async storeSyncRecord(payload: CreateStoreSyncRecord) {
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

    const storeIds = [...new Set(devices.map((device) => device.storesId))];

    const syncRecords = await Promise.all(
      storeIds.map((storesId) =>
        this.prisma.storeSyncRecord.create({
          data: {
            storesId,
            status: 'PENDING',
          },
          select: {
            id: true,
            storesId: true,
            status: true,
          },
        }),
      ),
    );

    await this.queueService.queueSync({
      payload,
      syncRecords,
    });

    return {
      success: true,
      message: 'Sync queued',
      data: {
        syncRecords,
      },
    };
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
      orderBy: {
        logDate: 'desc',
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
      const formattedDate = formatInTimeZone(
        record.logDate,
        'UTC',
        'MM/dd/yyyy',
      );

      const formattedTime = formatInTimeZone(record.logDate, 'UTC', 'HH:mm:ss');

      return {
        employeeID: String(record.userId),
        logDate: formattedDate,
        logTime: `${formattedDate} ${formattedTime}`,
        status:
          record.logType === 0
            ? '1'
            : record.logType === 1
              ? '0'
              : record.logType === 2
                ? '2'
                : '2',
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

  async getSyncRecordsByDeviceSerialNumbers(serialNumbers: string) {
    const deviceSerialNumbers = serialNumbers
      .split(',')
      .map((serial) => serial.trim())
      .filter(Boolean);

    if (deviceSerialNumbers.length === 0) {
      throw new BadRequestException('No device serial numbers provided');
    }

    const devices = await this.prisma.devices.findMany({
      where: {
        serialNumber: {
          in: deviceSerialNumbers,
        },
      },
      select: {
        serialNumber: true,
        store: {
          select: {
            id: true,
            code: true,
            name: true,
            storeSyncRecords: {
              orderBy: {
                syncDate: 'desc',
              },
              select: {
                id: true,
                syncDate: true,
                status: true,
                totalRecords: true,
                insertedRecords: true,
                failedRecords: true,
                errorMessage: true,
                startedAt: true,
                completedAt: true,
                storesId: true,
              },
            },
          },
        },
      },
    });

    if (devices.length === 0) {
      throw new NotFoundException('No devices found');
    }

    const foundSerialNumbers = new Set(
      devices.map((device) => device.serialNumber),
    );

    const missingSerialNumbers = deviceSerialNumbers.filter(
      (serial) => !foundSerialNumbers.has(serial),
    );

    return {
      success: true,
      message: 'Store sync records retrieved',
      data: devices.map((device) => ({
        deviceSerialNumber: device.serialNumber,
        store: device.store,
      })),
      missingSerialNumbers,
    };
  }
}
