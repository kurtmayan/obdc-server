import { Module } from '@nestjs/common';
import { SyncService } from './sync.service';
import { SyncController } from './sync.controller';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  providers: [SyncService, PrismaService],
  controllers: [SyncController],
})
export class SyncModule {}
