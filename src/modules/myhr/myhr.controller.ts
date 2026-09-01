import { Controller, Get, Param, Query } from '@nestjs/common';
import { MyHrService } from './myhr.service';
import { GetMyHRRecordDto } from './dto/get-my-hr-record.dto';
import { Public } from '../auth/auth.decorator';
import { SchedulerService } from '../scheduler/scheduler.service';

@Controller('myhr')
export class MyHrController {
  constructor(
    private readonly service: MyHrService,
    private readonly schedulerService: SchedulerService
  ) {}

  @Get()
  getMyHRRecords(@Query() query: GetMyHRRecordDto) {
    return this.service.getMyHrRecord(query)
  }

  @Public()
  @Get('sync')
  syncToMyHr() {
    this.schedulerService.handleCron();

    return {
      message: 'MyHR attendance synchronization has been triggered successfully.',
    };
  }

  @Get('biometrics/:batchID')
  getBiometricRecords(@Param('batchID') batchID: string) {
    return this.service.getBiometricsByBatchId(batchID)
  }

  @Get('status/:batchID')
  getBatchStatus(@Param('batchID') batchID: string) {
    return this.service.getMyHRBatchStatus(batchID)
  }

}

