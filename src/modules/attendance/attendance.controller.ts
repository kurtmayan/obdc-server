import { Controller, Get } from '@nestjs/common';
import { AttendanceService } from './attendance.service';

@Controller('attendance')
export class AttendanceController {
  constructor(private service: AttendanceService) {}

  @Get('all')
  getAllRecords() {
    return this.service.getAllData();
  }
}
