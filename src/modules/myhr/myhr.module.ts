import { Module } from '@nestjs/common';
import { MyHrService } from './myhr.service';
import { MyHrController } from './myhr.controller';
import { PrismaService } from '../prisma/prisma.service';
import { SqsQueueModule } from '../sqs-queue/sqs-queue.module';
import { FileSecurityModule } from '../file-security/file-security.module';
import { SchedulerService } from '../scheduler/scheduler.service';

@Module({
  imports: [SqsQueueModule, FileSecurityModule],
  controllers: [MyHrController],
  providers: [MyHrService, PrismaService, SchedulerService],
})
export class MyhrModule {}
