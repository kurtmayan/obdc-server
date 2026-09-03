import { Module } from '@nestjs/common';
import { SyncService } from './sync.service';
import { SyncController } from './sync.controller';
import { SqsQueueModule } from '../sqs-queue/sqs-queue.module';
import { FileSecurityModule } from '../file-security/file-security.module';

@Module({
  imports: [SqsQueueModule, FileSecurityModule],
  providers: [SyncService],
  controllers: [SyncController],
})
export class SyncModule {}
