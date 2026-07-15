import { Inject, Injectable } from '@nestjs/common';
import { SQS_CLIENT } from './sqs.constants';
import { ConfigService } from '@nestjs/config';
import {
  SendMessageCommand,
  SendMessageCommandOutput,
  SQSClient,
} from '@aws-sdk/client-sqs';

@Injectable()
export class SqsQueueService {
  private readonly queueUrl: string;

  constructor(
    @Inject(SQS_CLIENT)
    private readonly sqsClient: SQSClient,
    private readonly configService: ConfigService,
  ) {
    this.queueUrl = this.configService.getOrThrow<string>('AWS_SQS_QUEUE_URL');
  }

  async sendMessage<T>(payload: T): Promise<SendMessageCommandOutput> {
    console.log('it sends');
    return this.sqsClient.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify(payload),
      }),
    );
  }
}
