import {
  Injectable,
  Logger,
  LoggerService,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStoreSyncRecordDto } from 'src/generated/dto/storeSyncRecord/dto/create-storeSyncRecord.dto';

type Data = {
  name: string;
  user_id: string;
  timeIn: string;
  timeOut: string;
};

type StoredData = {
  attendance: Data[];
  'device-id': string;
  lastSync: Date;
};

@Injectable()
export class AttendanceService {
  private logger = new Logger(AttendanceService.name);

  private data: StoredData[] = [];

  constructor(private prisma: PrismaService) {}

  createAttendanceRecord(data: StoredData) {
    this.logger.log(data);
    const newData = { ...data, lastSync: new Date() };
    console.log(newData);

    this.data.push(newData);
    return data;
  }

  async getAllData() {
    return await this.prisma.storeSyncRecord.findMany({
      include: {
        attendanceRecord: true,
        store: {
          include: {
            devices: true,
          },
        },
      },
    });
    // const dataMapping = {
    //   'K40-PAS4252500165': {
    //     storeName: 'MR.DIY - Malolos Bulacan',
    //     region: 'Region III',
    //   },
    // };

    // console.log(dataMapping['K40-PAS4252500165']);

    // const transformedData = this.data.map((item) => {
    //   console.log('+++++++++++++++++++++');
    //   console.log(item);
    //   console.log('+++++++++++++++++++++');

    //   return {
    //     deviceId: item['device-id'],
    //     storeLoc: dataMapping[item['device-id'] as any],
    //     lastSync: item.lastSync,
    //     status: 'synced',
    //     attendance: item.attendance,
    //   };
    // });

    // console.log(transformedData);
    // return transformedData;
  }
}
