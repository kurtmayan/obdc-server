import { Controller, Get, Param, Query } from '@nestjs/common';
import { MyHrService } from './myhr.service';
import { GetMyHRRecordDto } from './dto/get-my-hr-record.dto';

@Controller('myhr')
export class MyHrController {
  constructor(private readonly service: MyHrService) {}

  //@Public()
  @Get()
  getMyHRRecords(@Query() query: GetMyHRRecordDto) {
    return this.service.getMyHrRecord(query)
  }

  @Get(':batchID')
  getBiometricRecords(@Param('batchID') batchID: string) {
    return this.service.getBiometricsByBatchId(batchID)
  }
}

