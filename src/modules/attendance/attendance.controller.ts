import { Controller, Get, Param } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { Public } from '../auth/auth.decorator';

@Controller('attendance')
export class AttendanceController {
  constructor(private attendanceService: AttendanceService) {}

  @Public()
  @Get('all')
  getAllRecords() {
    return this.attendanceService.getAllData();
  }

  @Public()
  @Get('store')
  getGeneralRecord() {
    return this.attendanceService.getGeneralRecord();
  }

  @Public()
  @Get('store/:storeId')
  getStoreRecord(@Param('storeId') storeId: string) {
    return this.attendanceService.getStoreRecord(storeId);
  }

  @Public()
  @Get('store/:id/:syncRecordId')
  getStoreDetailedRecord(
    @Param('storeId') storeId: string,
    @Param('syncRecordId') syncRecordId: string,
  ) {
    return this.attendanceService.getStoreDetailedRecord(storeId, syncRecordId);
  }
}
