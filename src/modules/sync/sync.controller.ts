import {
  Body,
  Controller,
  Get,
  Post,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { SyncService } from './sync.service';
import { CreateStoreSyncRecord } from './dto/create-store-sync-record.dto';
import { Public } from '../auth/auth.decorator';

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
  async exportAttendance(@Res() res) {
    const buffer = await this.service.export();

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );

    res.setHeader('Content-Disposition', 'attachment; filename="export.xlsx"');

    res.setHeader('Content-Length', buffer.length);

    return res.end(buffer);
  }
}
