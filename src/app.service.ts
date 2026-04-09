import { Injectable } from '@nestjs/common';
import { PrismaService } from './modules/prisma/prisma.service';
import { MailService } from './modules/mail/mail.service';

@Injectable()
export class AppService {
  constructor(private prismaService: PrismaService) {}
  async getHello() {
    return 'Hello World';
  }

  getUser() {
    return this.prismaService.users.findMany();
  }
}
