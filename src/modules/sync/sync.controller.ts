import { Body, Controller, Post } from '@nestjs/common';
import { SyncService } from './sync.service';
import { CreateStoreSyncRecord } from './dto/create-store-sync-record.dto';

@Controller('sync')
export class SyncController {
  constructor(private readonly service: SyncService) {}

  @Post()
  createSyncRecord(@Body() data: CreateStoreSyncRecord) {
    return this.service.storeSyncRecord(data);
  }
}
