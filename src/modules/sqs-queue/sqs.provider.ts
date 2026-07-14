import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SQSClient } from '@aws-sdk/client-sqs';
import { SQS_CLIENT } from './sqs.constants';

export const SqsClientProvider: Provider = {
  provide: SQS_CLIENT,
  inject: [ConfigService],
  useFactory: (configService: ConfigService): SQSClient => {
    return new SQSClient({
      region: configService.getOrThrow<string>('AWS_REGION'),
    });
  },
};