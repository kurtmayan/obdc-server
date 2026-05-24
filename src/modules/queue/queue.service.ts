import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';

@Injectable()
export class QueueService {
  constructor(@InjectQueue('sync') private readonly queue: Queue) {}

  async queueSync(payload: any) {
    const job = await this.queue.add('sample-task', payload, {
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
