import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AttendanceService {
  constructor(private prisma: PrismaService) {}

  async getAllData() {
    return await this.prisma.storeSyncRecord.findMany({
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
}
