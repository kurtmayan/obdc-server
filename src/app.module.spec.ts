jest.mock('@nestjs/schedule', () => ({
  Cron: () => () => undefined,
  CronExpression: { EVERY_HOUR: '0 0 * * * *' },
  ScheduleModule: {
    forRoot: () => ({ module: class MockScheduleModule {} }),
  },
}));

import { MODULE_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';
import { PrismaModule } from './modules/prisma/prisma.module';
import { PrismaService } from './modules/prisma/prisma.service';
import { StoreController } from './modules/store/store.controller';
import { StoreModule } from './modules/store/store.module';
import { StoreService } from './modules/store/store.service';

describe('application module ownership', () => {
  it('registers StoreController only in StoreModule', () => {
    const appControllers = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      AppModule,
    ) as unknown[];
    const storeControllers = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      StoreModule,
    ) as unknown[];

    expect(appControllers).not.toContain(StoreController);
    expect(storeControllers).toEqual([StoreController]);
  });

  it('resolves StoreController and StoreService from StoreModule', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, StoreModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();

    expect(moduleRef.get(StoreController)).toBeInstanceOf(StoreController);
    expect(moduleRef.get(StoreService)).toBeInstanceOf(StoreService);
  });
});
