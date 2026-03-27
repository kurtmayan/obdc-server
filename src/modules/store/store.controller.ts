import { Controller, Post } from '@nestjs/common';
import { StoreService } from './store.service';

@Controller('store')
export class StoreController {
  constructor(private readonly service: StoreService) {}

  @Post('new')
  async createNewStore() {
    return this.service.createNewStore();
  }
}
