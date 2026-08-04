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
import { EmployeeLookupDto } from './dto/employee-lookup.dto';
import { Public } from '../auth/auth.decorator';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { Roles } from '../roles/roles.decorator';
import { Role } from 'src/generated/prisma/browser';
import {
  ExportStoreSyncStatusDto,
  ExportStoreSyncStatusFormat,
} from './dto/export-store-sync-status.dto';

@Controller('sync')
export class SyncController {
  constructor(private readonly service: SyncService) {}

  @Public()
  @Post()
  createSyncRecord(@Body() data: CreateStoreSyncRecord) {
    return this.service.storeSyncRecord(data);
  }

  @Public()
  // @Roles(Role.SUPERADMIN)
  @Get('export')
  async exportAttendance(
    @Res() res: Response,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('format') format?: 'xlsx' | 'csv',
    @Query('storeIds') storeIds?: string,
    @Query('employeeIds') employeeIds?: string,
  ): Promise<void> {
    const buffer = await this.service.export(
      startDate,
      endDate,
      format,
      storeIds,
      employeeIds,
    );

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
  @Get('employee-lookup')
  employeeLookup(@Query() query: EmployeeLookupDto) {
    return this.service.employeeLookup(query);
  
  @Post('store-status/export')
  async exportStoreSyncStatus(
    @Query() query: ExportStoreSyncStatusDto,
    @Res() res: Response,
  ): Promise<void> {
    const buffer: Buffer = await this.service.exportStoreSyncStatus(query);
    const isCSV = query.format === ExportStoreSyncStatusFormat.CSV;
    const contentType = isCSV
      ? 'text/csv'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const filename = `sync-status-${query.startDate}-to-${query.endDate}.${query.format}`;

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

  // @Public()
  @Post('excel')
  @UseInterceptors(FileInterceptor('file'))
  async excelSyncRecord(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }
    return this.service.excelSyncRecord(file);
  }
}
