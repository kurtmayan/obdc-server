import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

export const ResendProvider: Provider = {
  provide: 'RESEND_CLIENT',
  inject: [ConfigService],
  useFactory: (configService: ConfigService) =>
    new Resend(configService.get<string>('RESEND_API_KEY')),
};
