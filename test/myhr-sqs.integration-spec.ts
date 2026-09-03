import { ConfigService } from '@nestjs/config';
import {
  CreateQueueCommand,
  DeleteMessageCommand,
  DeleteQueueCommand,
  ReceiveMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { SqsQueueService } from 'src/modules/sqs-queue/sqs-queue.service';

const describeIntegration =
  process.env.MYHR_INTEGRATION === 'true' ? describe : describe.skip;

describeIntegration('MyHR SQS integration', () => {
  let client: SQSClient;
  let queueUrl: string;

  beforeAll(async () => {
    client = new SQSClient({
      region: process.env.AWS_REGION,
      endpoint: process.env.AWS_SQS_ENDPOINT,
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    });
    const created = await createQueueWithRetry(client);
    if (!created.QueueUrl) throw new Error('Test SQS queue was not created');
    queueUrl = created.QueueUrl;
  });

  afterAll(async () => {
    if (queueUrl) {
      await client.send(new DeleteQueueCommand({ QueueUrl: queueUrl }));
    }
    client.destroy();
  });

  it('publishes and receives a versioned trigger contract', async () => {
    const service = new SqsQueueService(
      client,
      new ConfigService({ AWS_SQS_QUEUE_URL: queueUrl }),
    );
    const message = {
      version: 1 as const,
      type: 'START_MY_HR_SYNC' as const,
      payload: {
        triggerId: 'integration-trigger',
        source: 'MANUAL' as const,
        scheduledFor: new Date().toISOString(),
      },
      createdAt: new Date().toISOString(),
    };

    await service.sendMessage(message);
    const received = await client.send(
      new ReceiveMessageCommand({ QueueUrl: queueUrl, WaitTimeSeconds: 5 }),
    );
    const item = received.Messages?.[0];
    expect(JSON.parse(item?.Body ?? '{}')).toEqual(message);
    if (item?.ReceiptHandle) {
      await client.send(
        new DeleteMessageCommand({
          QueueUrl: queueUrl,
          ReceiptHandle: item.ReceiptHandle,
        }),
      );
    }
  });
});

async function createQueueWithRetry(client: SQSClient) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      return await client.send(
        new CreateQueueCommand({ QueueName: `myhr-integration-${Date.now()}` }),
      );
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  throw lastError;
}
