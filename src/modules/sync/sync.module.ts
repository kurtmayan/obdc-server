import { Module } from '@nestjs/common';
import { SyncService } from './sync.service';
import { SyncController } from './sync.controller';
import { PrismaService } from '../prisma/prisma.service';
import { SqsQueueModule } from '../sqs-queue/sqs-queue.module';

@Module({
  imports: [SqsQueueModule],
  providers: [SyncService, PrismaService],
  controllers: [SyncController],
})
export class SyncModule {}
