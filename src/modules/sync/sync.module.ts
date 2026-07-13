import { Module } from '@nestjs/common';
import { SyncService } from './sync.service';
import { SyncController } from './sync.controller';
import { PrismaService } from '../prisma/prisma.service';
import { QueueModule } from '../queue/queue.module';
import { SqsQueueModule } from '../sqs-queue/sqs-queue.module';

@Module({
  imports: [QueueModule],
  providers: [SyncService, PrismaService, SqsQueueModule],
  controllers: [SyncController],
})
export class SyncModule {}
