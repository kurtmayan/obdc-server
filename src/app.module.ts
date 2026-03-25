import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { DrizzleModule } from './modules/drizzle/drizzle.module';

@Module({
  imports: [AttendanceModule, DrizzleModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
