import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/auth.decorator';
import { SqsQueueService } from '../sqs-queue/sqs-queue.service';
import { TestingService } from './testing.service';

@Controller('testing')
export class TestingController {
  constructor(private readonly service: TestingService) {}

  @Public()
  @Get()
  async SqsTestQueue() {
    return this.service.testQueue('Laurence', 'TEST IS DONE');
  }
}
