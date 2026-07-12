import { Module } from '@nestjs/common';
import { TestingController } from './testing.controller';
import { TestingService } from './testing.service';
import { SqsQueueModule } from '../sqs-queue/sqs-queue.module';

@Module({
  controllers: [TestingController],
  providers: [TestingService],
  imports: [SqsQueueModule],
})
export class TestingModule {}
