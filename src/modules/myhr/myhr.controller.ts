import { Controller, Get, Param, Query } from '@nestjs/common';
import { MyHrService } from './myhr.service';
import { GetMyHRRecordDto } from './dto/get-my-hr-record.dto';
import { Public } from '../auth/auth.decorator';

@Controller('myhr')
export class MyHrController {
  constructor(private readonly service: MyHrService) {}

  @Public()
  @Get()
  getMyHRRecords(@Query() query: GetMyHRRecordDto) {
    return this.service.getMyHrRecord(query)
  }

  @Public()
  @Get('biometrics/:batchID')
  getBiometricRecords(@Param('batchID') batchID: string) {
    return this.service.getBiometricsByBatchId(batchID)
  }

  @Public()
  @Get('status/:batchID')
  getBatchStatus(@Param('batchID') batchID: string) {
    return this.service.getMyHRBatchStatus(batchID)
  }

}

