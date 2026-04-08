import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LoginAuthDto } from './dto/login-auth.dto';

@Injectable()
export class AuthService {
  constructor(private prismaService: PrismaService) {}

  async login(credentials: LoginAuthDto) {
    const checkUserExist = await this.prismaService.users.findFirst({
      where: {
        email: credentials.email,
      },
    });
    if (!checkUserExist) throw new NotFoundException('User not found');

    // c
  }
}
