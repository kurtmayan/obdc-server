import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LoginAuthDto } from './dto/login-auth.dto';
import * as bcrypt from 'bcrypt';
import otpGenerator from 'otp-generator';
import { MailService } from '../mail/mail.service';
import { VerifyOtpAuthDto } from './dto/verify-otp-auth.dto';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthService {
  constructor(
    private prismaService: PrismaService,
    private jwtService: JwtService,
    private mailService: MailService,
  ) {}

  async login(credentials: LoginAuthDto) {
    const checkUserExist = await this.prismaService.users.findFirst({
      where: {
        email: credentials.email,
      },
    });
    if (!checkUserExist) throw new UnauthorizedException('Invalid credentials');

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
}
