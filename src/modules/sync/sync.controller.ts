import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { SyncService } from './sync.service';
import { CreateStoreSyncRecord } from './dto/create-store-sync-record.dto';
import { Public } from '../auth/auth.decorator';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';

@Controller('sync')
export class SyncController {
  constructor(private readonly service: SyncService) {}

  @Public()
  @Post()
  createSyncRecord(@Body() data: CreateStoreSyncRecord) {
    return this.service.storeSyncRecord(data);
  }

  @Public()
  @Get('export')
  async exportAttendance(
    @Res() res: Response,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('format') format?: 'xlsx' | 'csv',
  ): Promise<void> {
    const buffer = await this.service.export(startDate, endDate, format);

    const isCSV = format === 'csv';
    const contentType = isCSV
      ? 'text/csv'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const filename = isCSV ? 'attendance-export.csv' : 'attendance-export.xlsx';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length.toString());

    res.end(buffer);
  }

  @Public()
  @Get('sync-records')
  async getSyncRecordsByDeviceSerialNumbers(
    @Query('serialNumbers') serialNumbers: string,
  ) {
    return this.service.getSyncRecordsByDeviceSerialNumbers(serialNumbers);
  }

  @Public()
  @Post('excel')
  @UseInterceptors(FileInterceptor('file'))
  async excelSyncRecord(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }
    return this.service.excelSyncRecord(file);
  }
}
