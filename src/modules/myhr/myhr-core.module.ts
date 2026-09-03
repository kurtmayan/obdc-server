import { Module } from '@nestjs/common';
import { MyHrClient } from './myhr.client';
import { MyHrService } from './myhr.service';
import { MyHrSyncService } from './myhr-sync.service';

@Module({
  providers: [MyHrClient, MyHrService, MyHrSyncService],
  exports: [MyHrClient, MyHrService, MyHrSyncService],
})
export class MyHrCoreModule {}
