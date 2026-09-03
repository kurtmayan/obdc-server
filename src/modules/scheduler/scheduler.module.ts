import { Module } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { SqsQueueModule } from '../sqs-queue/sqs-queue.module';

@Module({
  imports: [SqsQueueModule],
  providers: [SchedulerService],
  exports: [SchedulerService],
})
export class SchedulerModule {}
