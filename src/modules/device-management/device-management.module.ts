import { Module } from '@nestjs/common';
import { DeviceManagementService } from './device-management.service';
import { DeviceManagementController } from './device-management.controller';

@Module({
  providers: [DeviceManagementService],
  controllers: [DeviceManagementController]
})
export class DeviceManagementModule {}
