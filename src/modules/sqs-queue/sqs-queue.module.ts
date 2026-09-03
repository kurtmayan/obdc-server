import { Module } from '@nestjs/common';
import { SqsQueueService } from './sqs-queue.service';
import { SqsClientProvider } from './sqs.provider';

@Module({
  providers: [SqsQueueService, SqsClientProvider],
  exports: [SqsQueueService, SqsClientProvider],
})
export class SqsQueueModule {}
