import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { CreateStoreSyncRecord } from '../sync/dto/create-store-sync-record.dto';

@Injectable()
export class QueueService {
  constructor(@InjectQueue('sync') private readonly queue: Queue) {}

  async queueSync(payload: {
    payload: CreateStoreSyncRecord;
    syncRecords: { id: string; storesId: string }[];
  }) {
    const job = await this.queue.add('sync-task', payload, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
      removeOnComplete: true,
      removeOnFail: false,
    });

    return {
      jobId: job.id,
      status: 'queued',
    };
  }
}
