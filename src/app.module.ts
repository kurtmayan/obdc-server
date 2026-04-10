import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { ConfigModule } from '@nestjs/config';
import { PrismaService } from './modules/prisma/prisma.service';
import { StoreController } from './modules/store/store.controller';
import { StoreService } from './modules/store/store.service';
import { StoreModule } from './modules/store/store.module';
import { DeviceModule } from './modules/device/device.module';
import { SyncModule } from './modules/sync/sync.module';
import { AuthModule } from './modules/auth/auth.module';
import { APP_GUARD } from '@nestjs/core';
import { RolesGuard } from './modules/roles/roles.guard';
import { AuthGuard } from './modules/auth/auth.guard';
import { MailModule } from './modules/mail/mail.module';
import { UsersModule } from './modules/users/users.module';
import { StatisticsModule } from './modules/statistics/statistics.module';
import { ExcelModule } from './modules/excel/excel.module';

@Module({
  imports: [
    AttendanceModule,
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    StoreModule,
    DeviceModule,
    SyncModule,
    AuthModule,
    MailModule,
    UsersModule,
    StatisticsModule,
    ExcelModule,
  ],
  controllers: [AppController, StoreController],
  providers: [
    AppService,
    PrismaService,
    StoreService,
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule {}
