import { Injectable, Logger, LoggerService } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type Data = {
  name: string;
  user_id: string;
  timeIn: string;
  timeOut: string;
};

type StoredData = {
  attendance: Data[];
  'device-id': string;
};

@Injectable()
export class AttendanceService {
  private logger = new Logger(AttendanceService.name);

  private data: StoredData[] = [];

  constructor(private prisma: PrismaService) {}

  createAttendanceRecord(data: any) {
    this.logger.log(data);
    this.data.push(data);
    return data;
  }

  getAllData() {
    const dataMapping = {
      'K40-PAS4252500165': 'Malolos Bulacan',
    };

    console.log(dataMapping['K40-PAS4252500165']);

    const transformedData = this.data.map((item) => {
      console.log('+++++++++++++++++++++');
      console.log(item);
      console.log('+++++++++++++++++++++');

      return {
        storeLoc: dataMapping[item['device-id'] as any],
        attendance: item.attendance,
      };
    });

    console.log(transformedData);
    return transformedData;
  }
}
