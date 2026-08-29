import { PrismaService } from '../prisma/prisma.service';
import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import authenticateMyHr from 'src/lib/authenticateMyHr';

@Injectable()
export class MyHrService {
  private myHrToken: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  private async getMyHrToken(): Promise<string> {
    if (!this.myHrToken) {
      this.myHrToken = await authenticateMyHr(this.configService);
    }

    return this.myHrToken;
  }

  private clearMyHrToken(): void {
    this.myHrToken = null;
  }

  async getMyHrRecord({ 
    page, 
    pageSize
  }) {
    const skip = (page - 1) * pageSize;

    const [batches, total] = await Promise.all([
      this.prisma.myHRBatch.findMany({
        skip,
        take: pageSize,
        orderBy: {
          createdAt: 'desc',
        },
        include: {
          biometricRecords: true
        },
      }),
      this.prisma.myHRBatch.count(),
    ]);

    const batchesWithStatus : any = [];

    for (const batch of batches) {
      const status = await this.getBiometricUploadStatus(batch.id);
      
      batchesWithStatus.push({
        ...batch,
        status
      })
    }

    return {
      batches: batchesWithStatus,
      page,
      pageSize: pageSize,
      totalItems: total,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async getBiometricsByBatchId(batchID: string) {
    const biometrics = this.prisma.biometricRecord.findMany({
      where: {
        batchID
      }
    })

    return biometrics;
  }

  async getMyHRBatchStatus(batchID: string) {
    const batch = await this.prisma.myHRBatch.findUnique({
      where: {
        id: batchID,
      },
      include: {
        storeSyncRecord: {
          include: {
            store: true
          }
        }
      }
    });

    if (!batch) {
      throw new NotFoundException(`MyHR batch ${batchID} not found`);
    }

    const status = await this.getBiometricUploadStatus(batchID);

    return {
      ...batch,
      status,
    };
  }

  private async getBiometricUploadStatus(batchId: string) {
    let token = await this.getMyHrToken();

    const apiUrl =
      `${this.configService.getOrThrow<string>('MYHR_API_URL')}` +
      `/api/biometric/upload/bulk/status/${batchId}`;

    let response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });

    if (response.status === 401) {
      this.clearMyHrToken();
      token = await this.getMyHrToken();

      response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
    }

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `MyHR status request failed: ${response.status} ${errorBody}`,
      );
    }

    return await response.json();
  }
}