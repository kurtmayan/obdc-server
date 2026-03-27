import { Test, TestingModule } from '@nestjs/testing';
import { DeviceManagementService } from './device-management.service';

describe('DeviceManagementService', () => {
  let service: DeviceManagementService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DeviceManagementService],
    }).compile();

    service = module.get<DeviceManagementService>(DeviceManagementService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
