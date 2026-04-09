import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Resend } from 'resend';
import { SendOtpMailDto } from './dto/send-otp-mail.dto';
import * as path from 'path';
import { handlebars } from 'hbs';
import * as fs from 'fs';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class MailService {
  constructor(
    private configService: ConfigService,
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
      from: `otp@${this.configService.get<string>('RESEND_DOMAIN')}`,
      to: [args.email],
      html,
      subject: 'Your OTP Code',
    });

    return data;
  }

  async sendForgotPassword(args: {
    email: string;
    resetLink: string;
    name: string;
  }) {
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
      'forgot-password.hbs',
    );

    const templateSource = fs.readFileSync(templatePath, 'utf8');
    const template = handlebars.compile(templateSource);
    const html = template({
      name: args.name,
      resetLink: args.resetLink,
    });

    const data = await this.resend.emails.send({
      from: `noreply@${this.configService.get<string>('RESEND_DOMAIN')}`,
      to: [args.email],
      html,
      subject: 'Password Reset Request',
    });

    return data;
  }
}
