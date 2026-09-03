import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SqsConsumerModule } from './modules/sqs-queue/sqs-consumer.module';
import { PrismaModule } from './modules/prisma/prisma.module';
import { validateEnvironment } from './config/environment.validation';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnvironment,
    }),
    PrismaModule,
    SqsConsumerModule,
  ],
})
export class WorkerModule {}
