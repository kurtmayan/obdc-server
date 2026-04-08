import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Resend } from 'resend';
import { SendOtpMailDto } from './dto/send-otp-mail.dto';
import * as path from 'path';
import { handlebars } from 'hbs';
import * as fs from 'fs';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MailService {
  constructor(
    private prismaService: PrismaService,
    @Inject('RESEND_CLIENT') private readonly resend: Resend,
  ) {}

  async sendOtp(args: SendOtpMailDto) {
    const checkUserExist = await this.prismaService.users.findFirst({
      where: { email: args.email },
    });
    if (!checkUserExist) throw new NotFoundException('User not found');
    const templatePath = path.join(
      process.cwd(),
      'dist',
      'modules',
      'mail',
      'templates',
      'otp.hbs',
    );

    const templateSource = fs.readFileSync(templatePath, 'utf8');
    const template = handlebars.compile(templateSource);
    const html = template({
      name: checkUserExist.firstName + ' ' + checkUserExist.lastName,
      otp: args.otp,
    });

    const data = await this.resend.emails.send({
      from: 'otp@jkrmarmolvps.space',
      to: [args.email],
      html,
      subject: 'Your OTP Code',
    });

    return data;
  }
}
