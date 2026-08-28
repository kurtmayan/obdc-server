import { Controller } from '@nestjs/common';
import { MyHrService } from './myhr.service';

@Controller('myhr')
export class MyHrController {
  constructor(private readonly service: MyHrService) {}

}
