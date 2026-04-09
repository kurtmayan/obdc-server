import { Body, Controller, Get, Post, Res } from '@nestjs/common';
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
    const csv = await this.service.export();
    const todayDate = new Date();
    res.header('Content-Type', 'text/csv');
    res.header(
      'Content-Disposition',
      `attachment; filename="attendance-export-${todayDate}.csv"`,
    );
    return res.send(csv);
  }
}
