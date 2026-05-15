import { Body, Controller, Get, Post } from '@nestjs/common';
import { UsersService } from './users.service';
import { InviteUsersDto } from './dto/invite-users.dto';
import { Roles } from '../roles/roles.decorator';
import { Role } from 'src/generated/prisma/enums';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Roles(Role.SUPERADMIN)
  @Post('invite-users')
  inviteUsers(@Body() credentials: InviteUsersDto) {
    return this.usersService.inviteUsers(credentials);
  }

  @Get('/')
  getAllUsers() {
    return this.usersService.getAllUsers();
  }
}
