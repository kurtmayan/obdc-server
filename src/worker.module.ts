import { Module } from '@nestjs/common';
import { QueueModule } from './modules/queue/queue.module';
import { ConfigModule } from '@nestjs/config';
import { SqsQueueModule } from './modules/sqs-queue/sqs-queue.module';

@Module({
  imports: [
    // QueueModule,
    SqsQueueModule,
    ConfigModule.forRoot({
      isGlobal: true,
    }),
  ],
})
export class WorkerModule {}
