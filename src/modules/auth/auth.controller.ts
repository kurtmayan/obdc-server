import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginAuthDto } from './dto/login-auth.dto';
import { Public } from './auth.decorator';
import { VerifyOtpAuthDto } from './dto/verify-otp-auth.dto';
import type { Request } from 'express';
import { JwtPayload } from 'jsonwebtoken';
import { ResetPasswordAuthDto } from './dto/reset-password.auth.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  login(@Body() credentials: LoginAuthDto) {
    return this.authService.login(credentials);
  }

  @Public()
  @Post('verify-otp')
  verifyOtp(@Body() credentials: VerifyOtpAuthDto) {
    return this.authService.verifyOtp(credentials);
  }

  @Public()
  @Post('resend-otp')
  resendOtp(@Body('email') email: string) {
    return this.authService.resendOtp(email);
  }

  @Get('validate')
  validateToken(@Req() req: Request & { user: JwtPayload }) {
    return this.authService.validateToken(req.user);
  }

  @Public()
  @Post('forgot-password')
  forgotPassword(@Body('email') email: string) {
    return this.authService.forgotPassword(email);
  }

  @Public()
  @Post('reset-password')
  resetPassword(@Body() credentials: ResetPasswordAuthDto) {
    return this.authService.resetPassword(credentials);
  }

  @Post('request-password-reset-token/:id')
  generatePasswordResetToken(@Param('id') id: string) {
    return this.authService.generatePasswordResetToken(id);
  }
}
