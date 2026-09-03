import { MODULE_METADATA } from '@nestjs/common/constants';
import { MyHrOutboxPublisher } from '../myhr/myhr-outbox.publisher';
import { SqsConsumerModule } from './sqs-consumer.module';
import { SqsProcessor } from './sqs.processor';
import { SqsQueueModule } from './sqs-queue.module';

describe('SQS module topology', () => {
  it('keeps the producer module free of background consumers', () => {
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      SqsQueueModule,
    ) as unknown[];

    expect(providers).not.toContain(SqsProcessor);
    expect(providers).not.toContain(MyHrOutboxPublisher);
  });

  it('registers background processing only in the worker consumer module', () => {
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      SqsConsumerModule,
    ) as unknown[];

    expect(providers).toEqual(
      expect.arrayContaining([SqsProcessor, MyHrOutboxPublisher]),
    );
  });
});
