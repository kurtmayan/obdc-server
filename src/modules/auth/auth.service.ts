import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LoginAuthDto } from './dto/login-auth.dto';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthService {
  constructor(
    private prismaService: PrismaService,
    private jwtService: JwtService,
  ) {}

  async login(credentials: LoginAuthDto) {
    const checkUserExist = await this.prismaService.users.findFirst({
      where: {
        email: credentials.email,
      },
    });
    if (!checkUserExist) throw new NotFoundException('User not found');
    const isMatch = await bcrypt.compare(
      credentials.password,
      checkUserExist.password,
    );
    if (!isMatch) throw new ConflictException('Credential Error');
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
}
