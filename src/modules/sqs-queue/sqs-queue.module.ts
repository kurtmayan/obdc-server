import { Inject, Module } from '@nestjs/common';
import { SqsQueueService } from './sqs-queue.service';
import { SQS_CLIENT } from './sqs.constants';
import { ConfigService } from '@nestjs/config';
import {
  SendMessageCommand,
  SendMessageCommandOutput,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { SqsClientProvider } from './sqs.provider';
import { SqsProcessor } from './sqs.processor';
import { PrismaService } from '../prisma/prisma.service';
import { MyHrService } from '../myhr/myhr.service';

@Module({
  providers: [SqsQueueService, SqsClientProvider, SqsProcessor, PrismaService, MyHrService],
  exports: [SqsQueueService],
})
export class SqsQueueModule {}
