import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from 'src/generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SqsQueueService } from '../sqs-queue/sqs-queue.service';
import { MyHrSyncService } from './myhr-sync.service';
import { getPositiveInteger, sanitizeExternalText } from './myhr-sync.config';

type OutboxRow = {
  id: string;
  payload: Prisma.JsonValue;
  attemptCount: number;
};

@Injectable()
export class MyHrOutboxPublisher
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(MyHrOutboxPublisher.name);
  private running = false;
  private loopPromise: Promise<void> | null = null;
  private lastReconciliationAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sqs: SqsQueueService,
    private readonly syncService: MyHrSyncService,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap(): void {
    this.running = true;
    this.loopPromise = this.run();
  }

  async onApplicationShutdown(): Promise<void> {
    this.running = false;
    await this.loopPromise;
  }

  private async run(): Promise<void> {
    this.logger.log('event=myhr_outbox_started');
    while (this.running) {
      try {
        if (!this.isEnabled()) {
          await this.delay(5_000);
          continue;
        }
        const published = await this.publishOne();
        if (Date.now() - this.lastReconciliationAt >= 60_000) {
          await this.syncService.reconcile();
          this.lastReconciliationAt = Date.now();
        }
        if (!published) await this.delay(1_000);
      } catch (error) {
        this.logger.error(
          'event=myhr_outbox_loop_failed',
          error instanceof Error ? error.stack : String(error),
        );
        await this.delay(5_000);
      }
    }
  }

  private isEnabled(): boolean {
    return this.config.get<string>('MYHR_WORKER_ENABLED', 'false') === 'true';
  }

  private publishOne(): Promise<boolean> {
    return this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<OutboxRow[]>`
        SELECT "id", "payload", "attemptCount"
        FROM "MyHrOutbox"
        WHERE "publishedAt" IS NULL AND "availableAt" <= CURRENT_TIMESTAMP
        ORDER BY "availableAt", "createdAt"
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `;
        const entry = rows[0];
        if (!entry) return false;

        try {
          const result = await this.sqs.sendMessage(entry.payload);
          await tx.myHrOutbox.update({
            where: { id: entry.id },
            data: {
              publishedAt: new Date(),
              attemptCount: { increment: 1 },
              lastError: null,
            },
          });
          this.logger.log(
            `event=myhr_outbox_published outboxId=${entry.id} messageId=${result.MessageId ?? 'unknown'}`,
          );
        } catch (error) {
          const attempt = entry.attemptCount + 1;
          const delaySeconds = Math.min(300, 2 ** Math.min(attempt, 8));
          await tx.myHrOutbox.update({
            where: { id: entry.id },
            data: {
              attemptCount: { increment: 1 },
              availableAt: new Date(Date.now() + delaySeconds * 1_000),
              lastError: sanitizeExternalText(
                error instanceof Error ? error.message : String(error),
              ),
            },
          });
        }
        return true;
      },
      {
        timeout: getPositiveInteger(
          this.config,
          'MYHR_OUTBOX_TRANSACTION_TIMEOUT_MS',
          60_000,
        ),
      },
    );
  }

  private delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
}
