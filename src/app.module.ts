import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './modules/prisma/prisma.module';
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
import { TestingModule } from './modules/testing/testing.module';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditTrailModule } from './modules/audit-trail/audit-trail.module';
import { AuditTrailInterceptor } from './modules/audit-trail/audit-trail.interceptor';
import { MyhrModule } from './modules/myhr/myhr.module';
import { ScheduleModule } from '@nestjs/schedule';
import { validateEnvironment } from './config/environment.validation';

@Module({
  imports: [
    AttendanceModule,
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnvironment,
    }),
    PrismaModule,
    StoreModule,
    DeviceModule,
    SyncModule,
    AuthModule,
    MailModule,
    UsersModule,
    StatisticsModule,
    ExcelModule,
    TestingModule,
    AuditTrailModule,
    MyhrModule,
    ScheduleModule.forRoot(),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditTrailInterceptor,
    },
  ],
})
export class AppModule {}
