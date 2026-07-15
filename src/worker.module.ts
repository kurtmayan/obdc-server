import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SqsQueueModule } from './modules/sqs-queue/sqs-queue.module';

@Module({
  imports: [
    SqsQueueModule,
    ConfigModule.forRoot({
      isGlobal: true,
    }),
  ],
})
export class WorkerModule {}
