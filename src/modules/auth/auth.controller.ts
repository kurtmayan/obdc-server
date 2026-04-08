import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginAuthDto } from './dto/login-auth.dto';
import { Public } from './auth.decorator';
import { VerifyOtpAuthDto } from './dto/verify-otp-auth.dto';
import type { Request } from 'express';
import { JwtPayload } from 'jsonwebtoken';

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

  @Get('validate')
  validateToken(@Req() req: Request & { user: JwtPayload }) {
    return req.user;
  }
}
