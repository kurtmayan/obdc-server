import { Test, TestingModule } from '@nestjs/testing';
import { DeviceManagementController } from './device-management.controller';

describe('DeviceManagementController', () => {
  let controller: DeviceManagementController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DeviceManagementController],
    }).compile();

    controller = module.get<DeviceManagementController>(DeviceManagementController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
