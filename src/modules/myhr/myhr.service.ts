import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MyHrClient } from './myhr.client';

@Injectable()
export class MyHrService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly client: MyHrClient,
  ) {}

  async getMyHrRecord({ page, pageSize }: { page: number; pageSize: number }) {
    const skip = (page - 1) * pageSize;
    const [batches, total] = await Promise.all([
      this.prisma.myHRBatch.findMany({
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: { biometricRecords: true },
      }),
      this.prisma.myHRBatch.count(),
    ]);

    return {
      batches,
      page,
      pageSize,
      totalItems: total,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  getBiometricsByBatchId(batchID: string) {
    return this.prisma.biometricRecord.findMany({ where: { batchID } });
  }

  async getMyHRBatchStatus(batchID: string) {
    const batch = await this.prisma.myHRBatch.findUnique({
      where: { id: batchID },
    });
    if (!batch) {
      throw new NotFoundException(`MyHR batch ${batchID} not found`);
    }

    const status = await this.client.getBatchStatus(batchID);
    return { ...batch, status: status.status, rawStatus: status.raw };
  }
}
