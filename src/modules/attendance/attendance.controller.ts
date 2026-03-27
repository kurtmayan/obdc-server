import { Body, Controller, Get, Post } from '@nestjs/common';
import { AttendanceService } from './attendance.service';

@Controller('attendance')
export class AttendanceController {
  constructor(private service: AttendanceService) {}

  @Post('new')
  createAttendanceRecord(@Body() data: any) {
    return this.service.createAttendanceRecord(data);
  }

  @Get('all')
  getAllRecords() {
    return this.service.getAllData();
  }
}
