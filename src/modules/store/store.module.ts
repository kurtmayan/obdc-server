import { Module } from '@nestjs/common';
import { StoreService } from './store.service';
import { PrismaService } from '../prisma/prisma.service';
import { StoreController } from './store.controller';

@Module({
  controllers: [StoreController],
  providers: [StoreService, PrismaService],
})
export class StoreModule {}
