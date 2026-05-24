// src/queue/tasks.processor.ts
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';

@Processor('sync')
export class TaskProcessor extends WorkerHost {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job): Promise<any> {
    switch (job.name) {
      case 'create-sync':
        return this.handleSyncData(job.data);
      case 'sample-task':
        return this.sampleTask(job.data);
      default:
        throw new Error(`Unknown job type: ${job.name}`);
    }
  }

  private async handleSyncData(data: any) {
    console.log('Processing heavy task:', data);
    return {
      success: true,
    };
  }

  private async sampleTask(data: any) {
    console.log('Timer started... waiting for 5 seconds.');
    await this.delay(5000);
    return {
      success: true,
    };
  }

  private delay = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    console.log(`Job ${job.id} completed`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    console.error(`Job ${job.id} failed`, error);
  }
}
