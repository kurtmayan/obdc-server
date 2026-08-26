import { Body, Controller, Post } from '@nestjs/common';
import { MyHrService } from './myhr.service';
import { Public } from '../auth/auth.decorator';
import { CreateMyHrRecord } from './dto/create-myhr.dto';

@Controller('myhr')
export class MyHrController {
  constructor(private readonly service: MyHrService) {}

  @Public()
  @Post()
  createSyncRecord(@Body() data: CreateMyHrRecord) {
    return this.service.storeMyHrRecords(data);
  }
}
