import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { ConfigModule } from '@nestjs/config';
import { PrismaService } from './modules/prisma/prisma.service';
import { DeviceManagementModule } from './modules/device-management/device-management.module';
import { StoreController } from './modules/store/store.controller';
import { StoreModule } from './modules/store/store.module';
import { StoreService } from './modules/store/store.service';

@Module({
  imports: [
    AttendanceModule,
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    DeviceManagementModule,
    StoreModule,
  ],
  controllers: [AppController, StoreController],
  providers: [AppService, PrismaService, StoreService],
})
export class AppModule {}
