import {
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { Public } from '../auth/auth.decorator';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Express } from 'express';

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

  @Public()
  @Post('import')
  @UseInterceptors(FileInterceptor('file'))
  importAttendanceRecords(@UploadedFile() file: Express.Multer.File) {
    return this.attendanceService.importAttendanceRecords(file);
  }
}
