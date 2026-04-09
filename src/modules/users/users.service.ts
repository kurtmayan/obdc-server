import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InviteUsersDto } from './dto/invite-users.dto';
import { MailService } from '../mail/mail.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(
    private prismaService: PrismaService,
    private mailService: MailService,
  ) {}

  async inviteUsers(credentials: InviteUsersDto) {
    const checkEmailExist = await this.prismaService.users.findFirst({
      where: { email: credentials.email },
    });
    if (checkEmailExist?.id) {
      throw new ConflictException('User already exist');
    }
    const defaultPassword = this.generateDefaultPassword();
    const hashedPassword = await bcrypt.hash(defaultPassword, 10);
    const data = await this.prismaService.users.create({
      data: {
        email: credentials.email,
        firstName: credentials.firstName,
        middleName: '',
        lastName: credentials.lastName,
        role: credentials.role,
        contactNumber: credentials.contactNumber,
        password: hashedPassword,
        status: 'ACTIVE',
      },
    });
    if (!data) {
      throw new ConflictException('User has not been created');
    }
    await this.mailService.sendInviteUser({
      email: data.email,
      password: defaultPassword,
      name: `${data.firstName} ${data.lastName}`,
    });
    return {
      message: 'User invited successfully',
    };
  }

  private generateDefaultPassword(): string {
    return Math.random().toString(36).slice(-8);
  }
}
