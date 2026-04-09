import { Body, Controller, Post } from '@nestjs/common';
import { UsersService } from './users.service';
import { InviteUsersDto } from './dto/invite-users.dto';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post('invite-users')
  inviteUsers(@Body() credentials: InviteUsersDto) {
    return this.usersService.inviteUsers(credentials);
  }
}
