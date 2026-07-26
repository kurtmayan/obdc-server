import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
} from '@nestjs/common';
import { StoreService } from './store.service';
import { UpdateStoreDto } from './dto/update-store.dto';
import { CreateStoreDto } from './dto/create-store.dto';
import { Public } from '../auth/auth.decorator';
import { FindAllStoreDto, StoreLookup } from './dto/find-all.dto';

@Controller('store')
export class StoreController {
  constructor(private readonly storeService: StoreService) {}

  @Public()
  @Post()
  create(@Body() createStoreDto: CreateStoreDto) {
    return this.storeService.create(createStoreDto);
  }

  @Public()
  @Get()
  findAll(@Query() query: FindAllStoreDto) {
    return this.storeService.findAll(query);
  }

  @Public()
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.storeService.findOne(id);
  }

  @Public()
  @Patch(':id')
  update(@Param('id') id: string, @Body() updateStoreDto: UpdateStoreDto) {
    return this.storeService.update(id, updateStoreDto);
  }

  @Public()
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.storeService.remove(id);
  }

  @Public()
  @Patch('/deactivate/:id')
  deactivateStore(@Param('id') id: string) {
    return this.storeService.deactivateStore(id);
  }

  @Public()
  @Get('lookup')
  storesLookup(@Query() query: StoreLookup) {
    return this.storeService.storeLookup(query);
  }
}
