import { Module } from '@nestjs/common';
import { QueueModule } from './modules/queue/queue.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    QueueModule,
    ConfigModule.forRoot({
      isGlobal: true,
    }),
  ],
})
export class WorkerModule {}
