import { Controller, Get, Param, Query } from '@nestjs/common';
import { MyHrService } from './myhr.service';
import { GetMyHRRecordDto } from './dto/get-my-hr-record.dto';
import { Public } from '../auth/auth.decorator';
import { SqsQueueService } from '../sqs-queue/sqs-queue.service';

@Controller('myhr')
export class MyHrController {
  constructor(
    private readonly service: MyHrService,
    private readonly sqsQueueService: SqsQueueService,
  ) {}

  @Get()
  getMyHRRecords(@Query() query: GetMyHRRecordDto) {
    return this.service.getMyHrRecord(query)
  }

  @Public()
  @Get('sync')
  async syncToMyHr() {
    await this.sqsQueueService.sendMessage({
      type: 'SYNC_MY_HR_ATTENDANCE',
      payload: {},
      createdAt: new Date().toISOString(),
    });

    return {
      message: 'MyHR attendance synchronization has been queued successfully.',
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

