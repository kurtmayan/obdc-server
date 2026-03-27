import { Injectable, Logger, LoggerService } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AttendanceService {
  private logger = new Logger(AttendanceService.name);
  constructor(private prisma: PrismaService) {}

  createAttendanceRecord(data: any) {
    this.logger.log(data);
    return data;
  }
}
