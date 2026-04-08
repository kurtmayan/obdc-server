import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { Roles } from './modules/roles/roles.decorator';
import { Role } from './generated/prisma/enums';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Roles(Role.SUPERADMIN)
  @Get()
  getHello() {
    return this.appService.getHello();
  }

  @Get('/test')
  getUser() {
    return this.appService.getUser();
  }
}
