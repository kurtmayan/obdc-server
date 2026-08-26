import { Module } from '@nestjs/common';
import { MyHrService } from './myhr.service';
import { MyHrController } from './myhr.controller';
import { PrismaService } from '../prisma/prisma.service';
import { SqsQueueModule } from '../sqs-queue/sqs-queue.module';

@Module({
  imports: [SqsQueueModule],
  controllers: [MyHrController],
  providers: [MyHrService, PrismaService],
})
export class MyhrModule {}
