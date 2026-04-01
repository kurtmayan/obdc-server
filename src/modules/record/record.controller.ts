import { Controller, Get, Param } from '@nestjs/common';
import { RecordService } from './record.service';

@Controller('record')
export class RecordController {
  constructor(private readonly recordService: RecordService) {}

  @Get('store')
  getGeneralRecord() {
    return this.recordService.getGeneralRecord();
  }

  @Get('store/:storeId')
  getStoreRecord(@Param('storeId') storeId: string) {
    return this.recordService.getStoreRecord(storeId);
  }

  @Get('store/:id/:syncRecordId')
  getStoreDetailedRecord(
    @Param('storeId') storeId: string,
    @Param('syncRecordId') syncRecordId: string,
  ) {
    return this.recordService.getStoreDetailedRecord(storeId, syncRecordId);
  }
}
