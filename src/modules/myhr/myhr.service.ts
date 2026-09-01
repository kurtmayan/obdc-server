import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { LogStats, SyncStatus } from 'src/generated/prisma/enums';
import authenticateMyHr from 'src/lib/authenticateMyHr';
import { MyHrPayload } from 'src/types/my-hr';

export type MyHrUploadResult = {
  batchId: string;
  sent: number;
  saved: number;
};

@Injectable()
export class MyHrService {
  private myHrToken: string | null = null;
  private readonly chunkSize = 500;

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

  async uploadBiometrics(payload: MyHrPayload[]): Promise<MyHrUploadResult> {
    if (payload.length === 0) {
      throw new Error('MyHR payload is empty');
    }

    let token = await this.getMyHrToken();

    const apiUrl =
      `${this.configService.getOrThrow<string>('MYHR_API_URL')}` +
      '/api/biometric/upload/bulk';

    let response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (response.status === 401) {
      this.clearMyHrToken();
      token = await this.getMyHrToken();

      response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
    }

    const responseBody = await response.text();

    if (!response.ok) {
      throw new Error(
        `MyHR upload failed: ${response.status} ${response.statusText} - ${responseBody}`,
      );
    }

    let responseJson: { batchId?: string };

    try {
      responseJson = responseBody ? JSON.parse(responseBody) : {};
    } catch {
      throw new Error(`MyHR returned invalid JSON: ${responseBody}`);
    }

    if (!responseJson.batchId) {
      throw new Error('MyHR upload succeeded but no batchId was returned');
    }

    const batch = await this.prisma.myHRBatch.create({
      data: {
        id: responseJson.batchId,
      },
    });

    const result = await this.prisma.biometricRecord.createMany({
      data: payload.map((record) => ({
        empid: record.empid,
        logdt: record.logdt,
        logtm: record.logtm,
        logstats: this.getLogStats(record.logstats),
        location: record.location,
        batchID: batch.id,
      })),
    });

    return {
      batchId: batch.id,
      sent: payload.length,
      saved: result.count,
    };
  }

  chunkPayload(payload: MyHrPayload[]): MyHrPayload[][] {
    const chunks: MyHrPayload[][] = [];

    for (let i = 0; i < payload.length; i += this.chunkSize) {
      chunks.push(payload.slice(i, i + this.chunkSize));
    }

    return chunks;
  }

  async processChunk(chunkId: string): Promise<void> {
    const chunk = await this.prisma.myHrSyncChunk.findUnique({
      where: {
        id: chunkId,
      },
      include: {
        myHrSyncJob: true,
      },
    });

    if (!chunk) {
      throw new Error(`MyHR sync chunk not found: ${chunkId}`);
    }

    if (chunk.status === SyncStatus.SUCCESS) {
      return;
    }

    if (chunk.status === SyncStatus.FAILED) {
      throw new Error(`MyHR sync chunk ${chunkId} is already failed`);
    }

    const claimed = await this.prisma.myHrSyncChunk.updateMany({
      where: {
        id: chunkId,
        status: SyncStatus.PENDING,
      },
      data: {
        status: SyncStatus.PROCESSING,
        startedAt: new Date(),
        completedAt: null,
        errorMessage: null,
      },
    });

    if (claimed.count === 0) {
      const currentChunk = await this.prisma.myHrSyncChunk.findUnique({
        where: {
          id: chunkId,
        },
      });

      if (!currentChunk) {
        throw new Error(`MyHR sync chunk not found: ${chunkId}`);
      }

      if (currentChunk.status === SyncStatus.SUCCESS) {
        return;
      }

      return;
    }

    try {
      const payload = chunk.payload as unknown as MyHrPayload[];

      const result = await this.uploadBiometrics(payload);

      await this.prisma.myHrSyncChunk.update({
        where: {
          id: chunkId,
        },
        data: {
          status: SyncStatus.SUCCESS,
          insertedRecords: result.saved,
          failedRecords: 0,
          batchId: result.batchId,
          completedAt: new Date(),
          errorMessage: null,
        },
      });

      await this.finalizeJob(chunk.myHrSyncJobId);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      await this.prisma.myHrSyncChunk.updateMany({
        where: {
          id: chunkId,
          status: SyncStatus.PROCESSING,
        },
        data: {
          status: SyncStatus.FAILED,
          failedRecords: chunk.totalRecords,
          completedAt: new Date(),
          errorMessage,
        },
      });

      await this.prisma.myHrSyncJob.update({
        where: {
          id: chunk.myHrSyncJobId,
        },
        data: {
          status: SyncStatus.FAILED,
          errorMessage,
          completedAt: new Date(),
        },
      });

      throw error;
    }
  }

  private async finalizeJob(jobId: string): Promise<void> {
    const job = await this.prisma.myHrSyncJob.findUnique({
      where: {
        id: jobId,
      },
      include: {
        chunks: true,
      },
    });

    if (!job) {
      throw new Error(`MyHR sync job not found: ${jobId}`);
    }

    if (job.status === SyncStatus.FAILED) {
      return;
    }

    const hasFailedChunk = job.chunks.some(
      (chunk) => chunk.status === SyncStatus.FAILED,
    );

    if (hasFailedChunk) {
      await this.prisma.myHrSyncJob.update({
        where: {
          id: jobId,
        },
        data: {
          status: SyncStatus.FAILED,
          completedAt: new Date(),
        },
      });

      return;
    }

    const hasIncompleteChunk = job.chunks.some(
      (chunk) =>
        chunk.status === SyncStatus.PENDING ||
        chunk.status === SyncStatus.PROCESSING,
    );

    if (hasIncompleteChunk) {
      return;
    }

    const insertedRecords = job.chunks.reduce(
      (total, chunk) => total + chunk.insertedRecords,
      0,
    );

    const failedRecords = job.chunks.reduce(
      (total, chunk) => total + chunk.failedRecords,
      0,
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.myHrSyncJob.update({
        where: {
          id: jobId,
        },
        data: {
          status: SyncStatus.SUCCESS,
          insertedRecords,
          failedRecords,
          completedAt: new Date(),
          errorMessage: null,
        },
      });

      if (job.endDate && job.endRecordId) {
        await tx.myHrSync.update({
          where: {
            id: job.myHrSyncId,
          },
          data: {
            lastSyncedAt: job.endDate,
            lastRecordId: job.endRecordId,
          },
        });
      }
    });
  }

  async getMyHrRecord({
    page,
    pageSize,
  }: {
    page: number;
    pageSize: number;
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
          biometricRecords: true,
        },
      }),
      this.prisma.myHRBatch.count(),
    ]);

    const batchesWithStatus = await Promise.all(
      batches.map(async (batch) => {
        const status = await this.getBiometricUploadStatus(batch.id);

        return {
          ...batch,
          status,
        };
      }),
    );

    return {
      batches: batchesWithStatus,
      page,
      pageSize,
      totalItems: total,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async getBiometricsByBatchId(batchID: string) {
    return this.prisma.biometricRecord.findMany({
      where: {
        batchID,
      },
    });
  }

  async getMyHRBatchStatus(batchID: string) {
    const batch = await this.prisma.myHRBatch.findUnique({
      where: {
        id: batchID,
      },
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

    return response.json();
  }

  private getLogStats(value: number): LogStats {
    switch (value) {
      case 1:
        return 'TIME_IN';
      case 2:
        return 'TIME_OUT';
      default:
        return 'NO_VALUE';
    }
  }
}