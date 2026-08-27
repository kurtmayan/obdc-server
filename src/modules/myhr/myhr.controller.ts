import { BadRequestException, Body, Controller, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { MyHrService } from './myhr.service';
import { Public } from '../auth/auth.decorator';
import { CreateMyHrRecord } from './dto/create-myhr.dto';
import { FileInterceptor } from '@nestjs/platform-express';

@Controller('myhr')
export class MyHrController {
  constructor(private readonly service: MyHrService) {}

  @Public()
  @Post()
  createMyHrRecord(@Body() data: CreateMyHrRecord) {
    return this.service.storeMyHrRecords(data);
  }

  @Post('excel')
  @UseInterceptors(FileInterceptor('file'))
  async excelSyncMyHrRecord(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }
    return this.service.excelSyncMyHrRecord(file);
  }
}
