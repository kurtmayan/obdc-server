import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { Roles } from './modules/roles/roles.decorator';
import { Role } from './generated/prisma/enums';
import { Public } from './modules/auth/auth.decorator';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Roles(Role.SUPERADMIN)
  @Get()
  getHello() {
    return this.appService.getHello();
  }

  @Public()
  @Get('/test')
  async getUser() {
    return await this.appService.getUser();
  }
}
