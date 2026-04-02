import { Controller, Get, Param } from '@nestjs/common';
import { AttendanceService } from './attendance.service';

@Controller('attendance')
export class AttendanceController {
  constructor(private attendanceService: AttendanceService) {}

  @Get('all')
  getAllRecords() {
    return this.attendanceService.getAllData();
  }

  @Get('store')
  getGeneralRecord() {
    return this.attendanceService.getGeneralRecord();
  }

  @Get('store/:storeId')
  getStoreRecord(@Param('storeId') storeId: string) {
    return this.attendanceService.getStoreRecord(storeId);
  }

  @Get('store/:id/:syncRecordId')
  getStoreDetailedRecord(
    @Param('storeId') storeId: string,
    @Param('syncRecordId') syncRecordId: string,
  ) {
    return this.attendanceService.getStoreDetailedRecord(storeId, syncRecordId);
  }
}
