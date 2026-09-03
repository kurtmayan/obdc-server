import { Module } from '@nestjs/common';
import { MyHrController } from './myhr.controller';
import { FileSecurityModule } from '../file-security/file-security.module';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { MyHrCoreModule } from './myhr-core.module';

@Module({
  imports: [MyHrCoreModule, SchedulerModule, FileSecurityModule],
  controllers: [MyHrController],
  exports: [MyHrCoreModule],
})
export class MyhrModule {}
