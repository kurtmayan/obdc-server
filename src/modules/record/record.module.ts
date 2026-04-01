import { Module } from '@nestjs/common';
import { RecordService } from './record.service';
import { RecordController } from './record.controller';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  controllers: [RecordController],
  providers: [RecordService, PrismaService],
})
export class RecordModule {}
