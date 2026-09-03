import { Module } from '@nestjs/common';
import { MailService } from './mail.service';
import { ResendProvider } from './resend.provider';

@Module({
  imports: [],
  providers: [MailService, ResendProvider],
  exports: [MailService, ResendProvider],
})
export class MailModule {}
