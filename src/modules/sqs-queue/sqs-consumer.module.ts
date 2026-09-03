import { Module } from '@nestjs/common';
import { MyHrCoreModule } from '../myhr/myhr-core.module';
import { MyHrOutboxPublisher } from '../myhr/myhr-outbox.publisher';
import { SqsProcessor } from './sqs.processor';
import { SqsQueueModule } from './sqs-queue.module';

@Module({
  imports: [SqsQueueModule, MyHrCoreModule],
  providers: [SqsProcessor, MyHrOutboxPublisher],
})
export class SqsConsumerModule {}
