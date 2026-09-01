import { Module } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { PrismaService } from '../prisma/prisma.service';
import { SqsQueueModule } from '../sqs-queue/sqs-queue.module';
import { MyHrService } from '../myhr/myhr.service';

@Module({
  imports: [SqsQueueModule],
  providers: [SchedulerService, PrismaService, MyHrService],
  exports: [SchedulerService]
})
export class SchedulerModule {}
