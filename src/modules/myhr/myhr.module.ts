import { Module } from '@nestjs/common';
import { MyHrService } from './myhr.service';
import { MyHrController } from './myhr.controller';
import { PrismaService } from '../prisma/prisma.service';
import { SqsQueueModule } from '../sqs-queue/sqs-queue.module';
import { FileSecurityModule } from '../file-security/file-security.module';
import { SchedulerModule } from '../scheduler/scheduler.module';

@Module({
  imports: [SqsQueueModule, FileSecurityModule, SchedulerModule],
  controllers: [MyHrController],
  providers: [MyHrService, PrismaService],
})
export class MyhrModule {}
