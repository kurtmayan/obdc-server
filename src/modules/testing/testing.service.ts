import { Injectable } from '@nestjs/common';
import { SqsQueueService } from '../sqs-queue/sqs-queue.service';

@Injectable()
export class TestingService {
  constructor(private readonly sqs: SqsQueueService) {}

  async testQueue(message: string, name: string) {
    const payloadMessage = {
      type: 'TEST_QUEUE',
      payload: {
        message,
        name,
      },
      createdAt: new Date().toISOString(),
    };

    const result = await this.sqs.sendMessage(payloadMessage);

    return {
      messageId: result.MessageId,
      name,
      status: 'PENDING',
    };
  }
}
