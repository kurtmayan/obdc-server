import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Express } from 'express';
import { FindGeneralRecordDto } from './dto/find-general-record.dto';

@Controller('attendance')
export class AttendanceController {
  constructor(private attendanceService: AttendanceService) {}

  // @Public()
  @Get('all')
  getAllRecords() {
    return this.attendanceService.getAllData();
  }

  // @Public()
  @Get('store')
  getGeneralRecord(@Query() query: FindGeneralRecordDto) {
    return this.attendanceService.getGeneralRecord(query);
  }

  // @Public()
  @Get('store/:storeId')
  getStoreRecord(@Param('storeId') storeId: string) {
    return this.attendanceService.getStoreRecord(storeId);
  }

  // @Public()
  @Get('store/:id/:syncRecordId')
  getStoreDetailedRecord(
    @Param('storeId') storeId: string,
    @Param('syncRecordId') syncRecordId: string,
  ) {
    return this.attendanceService.getStoreDetailedRecord(storeId, syncRecordId);
  }

  // @Public()
  @Post('import')
  @UseInterceptors(FileInterceptor('file'))
  importAttendanceRecords(@UploadedFile() file: Express.Multer.File) {
    return this.attendanceService.importAttendanceRecords(file);
  }
}
