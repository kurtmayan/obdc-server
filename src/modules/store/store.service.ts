import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class StoreService {
  constructor(private readonly prisma: PrismaService) {}

  async createNewStore() {
    const newStore = await this.prisma.stores.create({
      data: {
        barangay: 'Barangay 424',
        exactAddress: '26 Vicente Cruz, Sampaloc Manila, Metro Manila',
        municipality: 'Manila City',
        name: 'Mr. DIY - Laurence Branch',
        province: 'Metro Manila',
        region: 'NCR',
      },
    });

    if (!newStore) throw new UnprocessableEntityException('Store not Created!');

    return newStore;
  }
}
