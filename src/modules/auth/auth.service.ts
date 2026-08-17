import {
  BadRequestException,
  Injectable,
  NotFoundException,
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
import { JwtPayload } from 'jsonwebtoken';
import { ROLE_PERMISSIONS } from 'src/config/permission';

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

    if (!checkUserExist.password) {
      throw new UnauthorizedException(
        'User has not been set up with a password. Please contact administrator.',
      );
    }

    const isMatch = await bcrypt.compare(
      credentials.password,
      checkUserExist.password,
    );
    if (!isMatch) {
      await this.prismaService.users.update({
        where: { id: checkUserExist.id },
        data: {
          loginFailedAttempts: {
            increment: 1
          },
        },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    const isAccountLocked =
      checkUserExist.loginFailedAttempts >= 5 ||
      checkUserExist.otpFailedAttempts >= 5;
    if (isAccountLocked) {
      throw new UnauthorizedException({
        message:
          'Your account is locked. Please contact your administrator for assistance.',
        error: 'Unauthorized',
        statusCode: 401,
        code: 'ACCOUNT_LOCKED',
      });
    }
    await this.prismaService.users.update({
      where: { id: checkUserExist.id },
      data: {
        loginFailedAttempts: 0,
      },
    });

    if (this.isPasswordExpired(checkUserExist.lastPasswordUpdate)) {
      const resetToken = await this.createPasswordResetToken(checkUserExist.id);
      throw new UnauthorizedException({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Password has expired. Please update your password.',
        code: 'PASSWORD_EXPIRED',
        data: {
          token: resetToken,
        },
      });
    }

    const currentDate = new Date();
    if (checkUserExist.otp && checkUserExist.otpExpiresAt) {
      const currentResendAvailableAt = new Date(
        checkUserExist.otpExpiresAt.getTime() - 4 * 60 * 1000,
      );
      if (currentDate < currentResendAvailableAt) {
        return {
          message: 'OTP Sent to email',
          otpExpiresAt: checkUserExist.otpExpiresAt,
          resendAvailableAt: currentResendAvailableAt,
        };
      }
    }

    const otp = otpGenerator.generate(6, {
      upperCaseAlphabets: false,
      lowerCaseAlphabets: false,
      specialChars: false,
    });
    const otpExpiresAt = new Date(currentDate.getTime() + 5 * 60 * 1000);
    const resendAvailableAt = new Date(otpExpiresAt.getTime() - 4 * 60 * 1000);
    const updateOtp = await this.prismaService.users.updateMany({
      where: {
        id: checkUserExist.id,
        otp: checkUserExist.otp,
        otpExpiresAt: checkUserExist.otpExpiresAt,
        loginFailedAttempts: {
          lt: 5,
        },
        otpFailedAttempts: {
          lt: 5,
        },
      },
      data: {
        otp: otp,
        otpExpiresAt,
      },
    });

    if (updateOtp.count !== 1) {
      const updatedUser = await this.prismaService.users.findUnique({
        where: { id: checkUserExist.id },
        select: {
          otp: true,
          otpExpiresAt: true,
          loginFailedAttempts: true,
          otpFailedAttempts: true,
        },
      });
      const isUpdatedAccountLocked =
        (updatedUser?.loginFailedAttempts ?? 5) >= 5 ||
        (updatedUser?.otpFailedAttempts ?? 5) >= 5;
      if (isUpdatedAccountLocked) {
        throw new UnauthorizedException({
          message:
            'Your account is locked. Please contact your administrator for assistance.',
          error: 'Unauthorized',
          statusCode: 401,
          code: 'ACCOUNT_LOCKED',
        });
      }

      if (updatedUser?.otp && updatedUser.otpExpiresAt) {
        return {
          message: 'OTP Sent to email',
          otpExpiresAt: updatedUser.otpExpiresAt,
          resendAvailableAt: new Date(
            updatedUser.otpExpiresAt.getTime() - 4 * 60 * 1000,
          ),
        };
      }

      throw new BadRequestException(
        'Unable to create an OTP. Please try again',
      );
    }

    await this.mailService.sendOtp({ email: checkUserExist.email, otp: otp });
    return {
      message: 'OTP Sent to email',
      otpExpiresAt,
      resendAvailableAt,
    };
  }

  async verifyOtp(credentials: VerifyOtpAuthDto) {
    const currentDate = new Date();
    const checkUserExist = await this.prismaService.users.findFirst({
      where: {
        email: credentials.email,
      },
    });
    if (!checkUserExist) throw new UnauthorizedException('Invalid credentials');

    const isAccountLocked =
      checkUserExist.loginFailedAttempts >= 5 ||
      checkUserExist.otpFailedAttempts >= 5;
    if (isAccountLocked) {
      throw new UnauthorizedException({
        message:
          'Your account is locked. Please contact your administrator for assistance.',
        error: 'Unauthorized',
        statusCode: 401,
        code: 'ACCOUNT_LOCKED',
      });
    }

    if (
      !checkUserExist.otp ||
      !checkUserExist.otpExpiresAt ||
      checkUserExist.otpExpiresAt <= currentDate
    ) {
      throw new UnauthorizedException({
        message: 'OTP expired',
        error: 'Unauthorized',
        statusCode: 401,
        code: 'OTP_EXPIRED',
      });
    }

    if (checkUserExist.otp !== credentials.otp) {
      const failedAttempt = await this.prismaService.users.updateMany({
        where: {
          id: checkUserExist.id,
          otp: checkUserExist.otp,
          otpExpiresAt: {
            gt: currentDate,
          },
          loginFailedAttempts: {
            lt: 5,
          },
          otpFailedAttempts: {
            lt: 5,
          },
        },
        data: {
          otpFailedAttempts: {
            increment: 1,
          },
        },
      });

      if (failedAttempt.count !== 1) {
        throw new UnauthorizedException('Invalid or expired OTP');
      }

      const updatedUser = await this.prismaService.users.findUnique({
        where: { id: checkUserExist.id },
        select: {
          loginFailedAttempts: true,
          otpFailedAttempts: true,
        },
      });
      const updatedOtpFailedAttempts = updatedUser?.otpFailedAttempts ?? 5;
      const isUpdatedAccountLocked =
        (updatedUser?.loginFailedAttempts ?? 5) >= 5 ||
        updatedOtpFailedAttempts >= 5;

      if (isUpdatedAccountLocked) {
        throw new UnauthorizedException({
          message:
            'Your account is locked. Please contact your administrator for assistance.',
          error: 'Unauthorized',
          statusCode: 401,
          code: 'ACCOUNT_LOCKED',
        });
      }

      const remainingAttempts = 5 - updatedOtpFailedAttempts;
      throw new UnauthorizedException({
        message: `Invalid OTP. ${remainingAttempts} attempts remaining.`,
        error: 'Unauthorized',
        statusCode: 401,
        code: 'INVALID_OTP',
        data: {
          remainingAttempts,
        },
      });
    }

    const consumeOtp = await this.prismaService.users.updateMany({
      where: {
        id: checkUserExist.id,
        otp: credentials.otp,
        otpExpiresAt: {
          gt: currentDate,
        },
        loginFailedAttempts: {
          lt: 5,
        },
        otpFailedAttempts: {
          lt: 5,
        },
      },
      data: {
        otp: null,
        otpExpiresAt: null,
        otpFailedAttempts: 0,
        status: 'ACTIVE',
      },
    });

    if (consumeOtp.count !== 1) {
      throw new UnauthorizedException('Invalid or expired OTP');
    }

    const payload = {
      sub: checkUserExist.id,
      email: checkUserExist.email,
      role: checkUserExist.role,
      firstName: checkUserExist.firstName,
      lastName: checkUserExist.lastName,
      middleName: checkUserExist.middleName,
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

    const isAccountLocked =
      checkUserExist.loginFailedAttempts >= 5 ||
      checkUserExist.otpFailedAttempts >= 5;
    if (isAccountLocked) {
      throw new UnauthorizedException({
        message:
          'Your account is locked. Please contact your administrator for assistance.',
        error: 'Unauthorized',
        statusCode: 401,
        code: 'ACCOUNT_LOCKED',
      });
    }

    if (!checkUserExist.otp || !checkUserExist.otpExpiresAt) {
      throw new BadRequestException('No OTP request found. Please login first');
    }

    const currentDate = new Date();
    const resendAvailableAt = new Date(
      checkUserExist.otpExpiresAt.getTime() - 4 * 60 * 1000,
    );
    if (currentDate < resendAvailableAt) {
      throw new BadRequestException({
        message: 'Please wait before requesting a new OTP',
        error: 'Bad Request',
        statusCode: 400,
        code: 'OTP_RESEND_COOLDOWN',
        data: {
          resendAvailableAt,
        },
      });
    }

    const otp = otpGenerator.generate(6, {
      upperCaseAlphabets: false,
      lowerCaseAlphabets: false,
      specialChars: false,
    });

    const otpExpiresAt = new Date(currentDate.getTime() + 5 * 60 * 1000);
    const nextResendAvailableAt = new Date(
      otpExpiresAt.getTime() - 4 * 60 * 1000,
    );
    const updateOtp = await this.prismaService.users.updateMany({
      where: {
        id: checkUserExist.id,
        otp: checkUserExist.otp,
        otpExpiresAt: checkUserExist.otpExpiresAt,
        loginFailedAttempts: {
          lt: 5,
        },
        otpFailedAttempts: {
          lt: 5,
        },
      },
      data: {
        otp,
        otpExpiresAt,
      },
    });

    if (updateOtp.count !== 1) {
      const updatedUser = await this.prismaService.users.findUnique({
        where: { id: checkUserExist.id },
        select: {
          otp: true,
          otpExpiresAt: true,
          loginFailedAttempts: true,
          otpFailedAttempts: true,
        },
      });
      const isUpdatedAccountLocked =
        (updatedUser?.loginFailedAttempts ?? 5) >= 5 ||
        (updatedUser?.otpFailedAttempts ?? 5) >= 5;
      if (isUpdatedAccountLocked) {
        throw new UnauthorizedException({
          message:
            'Your account is locked. Please contact your administrator for assistance.',
          error: 'Unauthorized',
          statusCode: 401,
          code: 'ACCOUNT_LOCKED',
        });
      }

      if (updatedUser?.otp && updatedUser.otpExpiresAt) {
        const updatedResendAvailableAt = new Date(
          updatedUser.otpExpiresAt.getTime() - 4 * 60 * 1000,
        );
        throw new BadRequestException({
          message: 'Please wait before requesting a new OTP',
          error: 'Bad Request',
          statusCode: 400,
          code: 'OTP_RESEND_COOLDOWN',
          data: {
            resendAvailableAt: updatedResendAvailableAt,
          },
        });
      }

      throw new BadRequestException('No OTP request found. Please login first');
    }

    await this.mailService.sendOtp({ email: checkUserExist.email, otp });

    return {
      message: 'OTP resent to email',
      otpExpiresAt,
      resendAvailableAt: nextResendAvailableAt,
    };
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

    const isSameAsPreviousPassword = (
      await Promise.all(
        checkUserExist.lastUserPassword.map(async (hashedPassword) =>
          bcrypt.compare(credentials.newPassword, hashedPassword),
        ),
      )
    ).some(Boolean);
    if (isSameAsPreviousPassword) {
      throw new BadRequestException(
        'New password must be different from your last 3 previous passwords.',
      );
    }

    const hashedPassword = await bcrypt.hash(credentials.newPassword, 10);
    const updatedPasswordHistory = [
      ...(checkUserExist.lastUserPassword ?? []),
      hashedPassword,
    ].slice(-3);

    await this.prismaService.users.update({
      where: { id: checkUserExist.id },
      data: {
        password: hashedPassword,
        passwordResetToken: null,
        passwordResetExpiresAt: null,
        lastPasswordUpdate: new Date(),
        lastUserPassword: updatedPasswordHistory,
      },
    });

    return { message: 'Password reset successfully' };
  }

  async validateToken(payload: JwtPayload) {
    const user = await this.prismaService.users.findUnique({
      where: {
        id: payload.sub,
      },
      select: {
        lastPasswordUpdate: true,
      },
    });
    return {
      ...payload,
      lastPasswordUpdate: user?.lastPasswordUpdate,
    };
  }

  async generatePasswordResetToken(id: string) {
    const user = await this.prismaService.users.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException('User with this ID does not exist');
    }
    const token = await this.createPasswordResetToken(user.id);
    return {
      token,
      message: 'Password reset token generated successfully',
    };
  }

  private async createPasswordResetToken(userId: string): Promise<string> {
    const token = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    await this.prismaService.users.update({
      where: { id: userId },
      data: {
        passwordResetToken: hashedToken,
        passwordResetExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
      },
    });
    return token;
  }

  private isPasswordExpired(lastPasswordUpdate: Date): boolean {
    const expirationDate = new Date(lastPasswordUpdate);
    expirationDate.setDate(expirationDate.getDate() + 90);
    return new Date() >= expirationDate;
  }

  async permission(payload: JwtPayload) {
    return ROLE_PERMISSIONS[payload.role] ?? payload;
  }
}
