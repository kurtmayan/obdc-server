import { Module } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { SqsQueueModule } from '../sqs-queue/sqs-queue.module';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  imports: [SqsQueueModule],
  providers: [SchedulerService, PrismaService],
  exports: [SchedulerService]
})
export class SchedulerModule {}
