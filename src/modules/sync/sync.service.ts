import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStoreSyncRecord } from './dto/create-store-sync-record.dto';

@Injectable()
export class SyncService {
  constructor(private readonly prisma: PrismaService) {}

  private logger = new Logger(SyncService.name);

  async storeSyncRecord(data: CreateStoreSyncRecord) {
    const device = await this.prisma.devices.findFirst({
      where: {
        serialNumber: data.device_id,
      },
      select: {
        store: true,
      },
    });

    if (!device) throw new NotFoundException();

    const storeSyncRecord = await this.prisma.storeSyncRecord.create({
      data: {
        storesId: device.store.id,
      },
    });

    if (!storeSyncRecord)
      throw new ConflictException('Sync record not created!');

    const transformedData = data.attendance.map((log) => {
      return {
        employeeName: log.name,
        userId: log.user_id,
        logDate: new Date(log.logDate),
        logType: log.logType,
        storeSyncRecordID: storeSyncRecord.id,
      };
    });

    const attendanceRecord = await this.prisma.attendanceRecord.createMany({
      data: transformedData,
    });

    if (!attendanceRecord)
      throw new UnprocessableEntityException(
        "There's an error while saving records in the database!",
      );

    this.logger.log(attendanceRecord);

    return { success: true, message: 'Record Synced', data: attendanceRecord };
  }

  async export() {
    const attendanceRecords = await this.prisma.attendanceRecord.findMany({
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

    const csvHeader =
      'User ID, Employee Name,Log Date,Log Type,Store Name,Store Region,Sync Date\n';
    const csvRows = attendanceRecords
      .map((record) => {
        const store = record.storeSyncRecords.store;
        return `${record.userId},${record.employeeName},${record.logDate.toISOString()},${record.logType},${store.name},${store.region},${record.storeSyncRecords.syncDate.toISOString()}`;
      })
      .join('\n');

    return csvHeader + csvRows;
  }
}
