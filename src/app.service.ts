import { Injectable } from '@nestjs/common';
import { PrismaService } from './modules/prisma/prisma.service';
import { MailService } from './modules/mail/mail.service';

@Injectable()
export class AppService {
  constructor(private prismaService: PrismaService) {}
  async getHello() {
    return 'Hello World';
  }

  async getUser() {
    try {
      await this.prismaService.users.findMany();
      return { status: 'ok' };
    } catch (e) {
      return {
        error: e,
      };
    }
  }
}
