import { Module } from '@nestjs/common';
import { MyHrService } from './myhr.service';
import { MyHrController } from './myhr.controller';

@Module({
  controllers: [MyHrController],
  providers: [MyHrService],
})
export class MyhrModule {}
