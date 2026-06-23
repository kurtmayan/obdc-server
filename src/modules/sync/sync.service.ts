import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type {
  Attendance,
  CreateStoreSyncRecord,
  SyncRecord,
} from './dto/create-store-sync-record.dto';
import * as ExcelJS from 'exceljs';
import { QueueService } from '../queue/queue.service';
import { formatInTimeZone } from 'date-fns-tz';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';
import { SyncStatus } from 'src/generated/prisma/enums';
import type {
  StoreSyncRecordGetPayload,
  StoreSyncRecordSelect,
} from 'src/generated/prisma/models';
import { ConfigService } from '@nestjs/config';

type ExportFormat = 'xlsx' | 'csv';

type ExportRow = {
  employeeID: string;
  logDate: string;
  logTime: string;
  status: '0' | '1' | '2';
  location: string;
};

const storeSyncRecordSelect = {
  id: true,
  storesId: true,
  status: true,
} as const satisfies StoreSyncRecordSelect;

type QueuedStoreSyncRecord = StoreSyncRecordGetPayload<{
  select: typeof storeSyncRecordSelect;
}>;

@Injectable()
export class SyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
    private readonly configService: ConfigService,
  ) {}

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

    const syncRecords: QueuedStoreSyncRecord[] = await Promise.all(
      storeIds.map((storesId) =>
        this.prisma.storeSyncRecord.create({
          data: {
            storesId,
            status: SyncStatus.PENDING,
          },
          select: storeSyncRecordSelect,
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

  async export(
    startDate?: string,
    endDate?: string,
    format: ExportFormat = 'xlsx',
  ): Promise<Buffer> {
    return this.generateExport(startDate, endDate, format);
  }

  async excelSyncRecord(file: Express.Multer.File) {
    const verifiedExcelBuffer = this.extractAndVerifySignedExcel(file);

    const attendanceRecord = await this.parseExcelAndSync(verifiedExcelBuffer);

    return this.storeSyncRecord(attendanceRecord);
  }

  private decryptEncryptedExportFile(encryptedBuffer: Buffer): Buffer {
    const keyBase64 = this.configService.get('OBDC_ENCRYPTION_KEY');
    console.log(keyBase64);

    if (!keyBase64) {
      throw new BadRequestException(
        'Missing OBDC_ENCRYPTION_KEY environment variable',
      );
    }

    const key = Buffer.from(keyBase64, 'base64');

    if (key.length !== 32) {
      throw new BadRequestException(
        'OBDC_ENCRYPTION_KEY must decode to 32 bytes',
      );
    }

    if (encryptedBuffer.length <= 28) {
      throw new BadRequestException('Invalid encrypted file');
    }

    const nonce = encryptedBuffer.subarray(0, 12);
    const encryptedData = encryptedBuffer.subarray(12);

    const ciphertext = encryptedData.subarray(0, encryptedData.length - 16);
    const authTag = encryptedData.subarray(encryptedData.length - 16);

    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
      decipher.setAuthTag(authTag);

      return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch {
      throw new BadRequestException(
        'Unable to decrypt file. The file may be invalid, modified, or encrypted with the wrong key.',
      );
    }
  }

  private extractAndVerifySignedExcel(file: Express.Multer.File): Buffer {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    if (!file.originalname.toLowerCase().endsWith('.enc')) {
      throw new BadRequestException(
        'Please upload the encrypted .enc file from LBDC',
      );
    }

    const decryptedZipBuffer = this.decryptEncryptedExportFile(file.buffer);

    const zip: AdmZip = new AdmZip(decryptedZipBuffer);

    const excelEntry = zip.getEntry('attendance_export.xlsx');

    const signatureEntry = zip.getEntry('attendance_export.xlsx.sig');

    if (!excelEntry || !signatureEntry) {
      throw new BadRequestException(
        'Invalid ZIP. It must contain attendance_export.xlsx and attendance_export.xlsx.sig',
      );
    }

    const excelBuffer = excelEntry.getData();

    const signatureBase64 = signatureEntry.getData().toString('utf8').trim();

    const isValid = this.verifyLbdcSignature(excelBuffer, signatureBase64);

    if (!isValid) {
      throw new BadRequestException(
        'Invalid file signature. The Excel file may have been modified.',
      );
    }

    return excelBuffer;
  }

  private verifyLbdcSignature(
    excelBuffer: Buffer,
    signatureBase64: string,
  ): boolean {
    const publicKeyPath = path.join(
      process.cwd(),
      'keys',
      'lbdc_public_key.pem',
    );

    if (!fs.existsSync(publicKeyPath)) {
      throw new BadRequestException(
        `LBDC public key not found at ${publicKeyPath}`,
      );
    }

    const publicKey = fs.readFileSync(publicKeyPath, 'utf8');
    const signature = Buffer.from(signatureBase64, 'base64');

    return crypto.verify(
      'sha256',
      excelBuffer,
      {
        key: publicKey,
        padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
        saltLength: crypto.constants.RSA_PSS_SALTLEN_MAX_SIGN,
      },
      signature,
    );
  }

  private async parseExcelAndSync(
    buffer: Buffer,
  ): Promise<CreateStoreSyncRecord> {
    const workbook = new ExcelJS.Workbook();
    const excelBuffer = new ArrayBuffer(buffer.byteLength);
    new Uint8Array(excelBuffer).set(buffer);

    await workbook.xlsx.load(excelBuffer);
    const worksheet = workbook.worksheets[0];

    if (!worksheet || worksheet.rowCount < 2) {
      throw new BadRequestException('No data found in Excel file');
    }

    const syncRecords = new Map<string, SyncRecord>();
    let rowCount = 0;

    // Process rows directly without storing them
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // Skip header
      rowCount++;

      // New column format: ID, Serial Number, Name, User ID, Log Date, Log Type
      const id = this.getCellText(row.getCell(1).value);
      const deviceIdRaw = this.getCellText(row.getCell(2).value);
      const employeeName = this.getCellText(row.getCell(3).value);
      const employeeId = this.getCellText(row.getCell(4).value);
      const logDate = this.getCellText(row.getCell(5).value);
      const punch = this.getPunchValue(row.getCell(6).value, rowNumber);

      // Validate all required fields exist
      if (!id || !deviceIdRaw || !employeeId || !employeeName || !logDate) {
        throw new BadRequestException(
          `Row ${rowNumber}: Missing required fields`,
        );
      }

      // Extract first device serial number if it contains comma
      const deviceId = deviceIdRaw.split(',')[0].trim();

      // Single Map operation - use has() before get to avoid double lookup
      let record = syncRecords.get(deviceId);
      if (!record) {
        record = {
          device_id: deviceId,
          attendance_record: [],
        };
        syncRecords.set(deviceId, record);
      }

      const attendanceRecord: Attendance = {
        employee_name: employeeName,
        employee_id: employeeId,
        log_date: logDate,
        punch,
        id,
      };

      // Add attendance record
      record.attendance_record.push(attendanceRecord);
    });

    if (rowCount === 0) {
      throw new BadRequestException('No data rows found in Excel file');
    }

    return {
      sync_record: Array.from(syncRecords.values()),
    };
  }

  private async generateExport(
    startDate?: string,
    endDate?: string,
    format: ExportFormat = 'xlsx',
  ): Promise<Buffer> {
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
    const transformedData: ExportRow[] = attendanceRecords.map((record) => {
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
        status: this.mapLogTypeToExportStatus(record.logType),
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

  private exportAsCSV(data: ExportRow[]): Buffer {
    const headers = ['EMPID', 'Log Date', 'Log Time', 'Status', 'Location'];
    const rows: string[][] = [headers];

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
      .map((row) => row.map((cell) => this.escapeCsvCell(cell)).join(','))
      .join('\n');

    return Buffer.from(csvContent, 'utf-8');
  }

  private async exportAsExcel(data: ExportRow[]): Promise<Buffer> {
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

  private getCellText(value: ExcelJS.CellValue): string | undefined {
    if (value === null || value === undefined) {
      return undefined;
    }

    if (value instanceof Date) {
      return formatInTimeZone(value, 'UTC', 'yyyy-MM-dd HH:mm:ss');
    }

    if (typeof value !== 'object') {
      return this.trimToUndefined(String(value));
    }

    if ('result' in value) {
      return this.getCellText(value.result);
    }

    if ('text' in value) {
      return this.trimToUndefined(value.text);
    }

    if ('richText' in value) {
      return this.trimToUndefined(
        value.richText.map((richText) => richText.text).join(''),
      );
    }

    return undefined;
  }

  private getPunchValue(value: ExcelJS.CellValue, rowNumber: number): number {
    const text = this.getCellText(value);
    const punch = text === undefined ? Number.NaN : Number(text);

    if (!Number.isInteger(punch)) {
      throw new BadRequestException(`Row ${rowNumber}: Invalid log type`);
    }

    return punch;
  }

  private trimToUndefined(value: string): string | undefined {
    const trimmedValue = value.trim();
    return trimmedValue.length > 0 ? trimmedValue : undefined;
  }

  private mapLogTypeToExportStatus(logType: number): ExportRow['status'] {
    if (logType === 0) return '1';
    if (logType === 1) return '0';
    return '2';
  }

  private escapeCsvCell(cell: string): string {
    return `"${cell.replace(/"/g, '""')}"`;
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
