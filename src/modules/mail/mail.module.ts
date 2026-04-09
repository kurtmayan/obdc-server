import { Module } from '@nestjs/common';
import { MailService } from './mail.service';
import { ResendProvider } from './resend.provider';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  imports: [],
  providers: [MailService, PrismaService, ResendProvider],
  exports: [MailService, ResendProvider],
})
export class MailModule {}
