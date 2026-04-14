import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LoginAuthDto } from './dto/login-auth.dto';
import * as bcrypt from 'bcrypt';
import otpGenerator from 'otp-generator';
import { MailService } from '../mail/mail.service';
import { VerifyOtpAuthDto } from './dto/verify-otp-auth.dto';
import { JwtService } from '@nestjs/jwt';
import { ResetPasswordAuthDto } from './dto/reset-password.auth.dto';
import crypto from 'crypto';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AuthService {
  constructor(
    private prismaService: PrismaService,
    private jwtService: JwtService,
    private mailService: MailService,
    private configService: ConfigService,
  ) {}

  async login(credentials: LoginAuthDto) {
    const checkUserExist = await this.prismaService.users.findFirst({
      where: {
        email: credentials.email,
      },
    });
    if (!checkUserExist) throw new UnauthorizedException('Invalid credentials');

    if (checkUserExist.status !== 'ACTIVE' || !checkUserExist.password) {
      throw new UnauthorizedException('User has not been activated');
    }

    const isMatch = await bcrypt.compare(
      credentials.password,
      checkUserExist.password,
    );
    if (!isMatch) throw new UnauthorizedException('Invalid credentials');

    const otp = otpGenerator.generate(6, {
      upperCaseAlphabets: false,
      lowerCaseAlphabets: false,
      specialChars: false,
    });
    await this.prismaService.users.update({
      where: {
        id: checkUserExist.id,
      },
      data: {
        otp: otp,
        otpExpiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes OTP expiration
      },
    });
    await this.mailService.sendOtp({ email: checkUserExist.email, otp: otp });
    return {
      message: 'OTP Sent to email',
    };
  }

  async verifyOtp(credentials: VerifyOtpAuthDto) {
    const checkCredentialValid = await this.prismaService.users.findFirst({
      where: {
        email: credentials.email,
        otp: credentials.otp,
      },
    });
    if (!checkCredentialValid)
      throw new UnauthorizedException('Invalid credentials');

    if (
      !checkCredentialValid.otpExpiresAt ||
      checkCredentialValid.otpExpiresAt < new Date()
    ) {
      throw new UnauthorizedException('OTP expired');
    }

    await this.prismaService.users.update({
      where: { id: checkCredentialValid.id },
      data: { otp: null, otpExpiresAt: null },
    });

    const payload = {
      sub: checkCredentialValid.id,
      email: checkCredentialValid.email,
      role: checkCredentialValid.role,
      firstName: checkCredentialValid.firstName,
      lastName: checkCredentialValid.lastName,
      middleName: checkCredentialValid.middleName,
    };
    const jwtToken = await this.jwtService.signAsync(payload);
    return {
      accessToken: jwtToken,
    };
  }

  async resendOtp(email: string) {
    const checkUserExist = await this.prismaService.users.findFirst({
      where: { email },
    });
    if (!checkUserExist) throw new UnauthorizedException('Invalid credentials');

    if (!checkUserExist.otpExpiresAt) {
      throw new BadRequestException('No OTP request found. Please login first');
    }

    if (
      checkUserExist.otpExpiresAt > new Date() &&
      checkUserExist.otpExpiresAt < new Date(Date.now() + 4 * 60 * 1000)
    ) {
      throw new BadRequestException('Please wait before requesting a new OTP');
    }

    const otp = otpGenerator.generate(6, {
      upperCaseAlphabets: false,
      lowerCaseAlphabets: false,
      specialChars: false,
    });

    await this.prismaService.users.update({
      where: { id: checkUserExist.id },
      data: {
        otp,
        otpExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
    });

    await this.mailService.sendOtp({ email: checkUserExist.email, otp });

    return { message: 'OTP resent to email' };
  }

  async forgotPassword(email: string) {
    const checkUserExist = await this.prismaService.users.findFirst({
      where: { email },
    });

    // Don't reveal if email exists or not (security best practice)
    if (!checkUserExist) {
      return {
        message: 'If this email exists, a password reset link has been sent',
      };
    }

    // Generate a secure reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto
      .createHash('sha256')
      .update(resetToken)
      .digest('hex');

    await this.prismaService.users.update({
      where: { id: checkUserExist.id },
      data: {
        passwordResetToken: hashedToken,
        passwordResetExpiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 minutes
      },
    });

    // The raw token goes in the link, the hashed one is stored in DB
    const resetLink = `${this.configService.get<string>('FRONTEND_URL')}/auth/update-password?token=${resetToken}&email=${email}`;

    await this.mailService.sendForgotPassword({
      email,
      resetLink,
      name: `${checkUserExist.firstName} ${checkUserExist.lastName}`,
    });

    return {
      message: 'If this email exists, a password reset link has been sent',
    };
  }

  async resetPassword(credentials: ResetPasswordAuthDto) {
    const hashedToken = crypto
      .createHash('sha256')
      .update(credentials.token)
      .digest('hex');

    const checkUserExist = await this.prismaService.users.findFirst({
      where: {
        email: credentials.email,
        passwordResetToken: hashedToken,
      },
    });
    if (!checkUserExist)
      throw new UnauthorizedException('Invalid or expired reset link');

    if (
      !checkUserExist.passwordResetExpiresAt ||
      checkUserExist.passwordResetExpiresAt < new Date()
    ) {
      throw new UnauthorizedException(
        'Reset link has expired. Please request a new one',
      );
    }

    const hashedPassword = await bcrypt.hash(credentials.newPassword, 10);

    await this.prismaService.users.update({
      where: { id: checkUserExist.id },
      data: {
        password: hashedPassword,
        passwordResetToken: null,
        passwordResetExpiresAt: null,
      },
    });

    return { message: 'Password reset successfully' };
  }
}
