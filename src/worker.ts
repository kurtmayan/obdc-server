import { NestFactory } from '@nestjs/core';
import { createAppLogger } from './config/logger';
import { WorkerModule } from './worker.module';

async function bootstrap() {
  await NestFactory.createApplicationContext(WorkerModule, {
    logger: createAppLogger(),
  });
  console.log('Worker started');
}

bootstrap();
