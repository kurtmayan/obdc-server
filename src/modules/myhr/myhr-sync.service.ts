import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import {
  MyHrChunkStatus,
  MyHrJobStatus,
  MyHrOutboxMessageType,
  MyHrRecordSyncStatus,
  MyHrTriggerOutcome,
  MyHrTriggerSource as MyHrTriggerSourceEnum,
  MyHrUploadAttemptStatus,
} from 'src/generated/prisma/enums';
import { Prisma } from 'src/generated/prisma/client';
import {
  StartMyHrSyncMessage,
  VersionedQueueMessage,
} from 'src/types/sqs-message';
import { MyHrPayload, MyHrSyncPayload } from 'src/types/my-hr';
import { PrismaService } from '../prisma/prisma.service';
import { MyHrClient, MyHrClientError } from './myhr.client';
import { getPositiveInteger, sanitizeExternalText } from './myhr-sync.config';
import {
  mapAttendanceToMyHr,
  mapMyHrLogStats,
  parseMyHrPayload,
} from './myhr.mapper';
import { deriveMyHrJobSummary } from './myhr-state-machine';

type TransactionClient = Parameters<
  Parameters<PrismaService['$transaction']>[0]
>[0];

type ClaimedUpload = {
  attemptId: string;
  attemptNumber: number;
  claimToken: string;
};

@Injectable()
export class MyHrSyncService {
  private readonly logger = new Logger(MyHrSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly client: MyHrClient,
  ) {}

  async handleTrigger(payload: StartMyHrSyncMessage): Promise<void> {
    const scheduledFor = new Date(payload.scheduledFor);
    if (Number.isNaN(scheduledFor.getTime())) {
      throw new Error('Invalid MyHR trigger scheduledFor value');
    }

    const result = await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('obdc:myhr:job'))::text AS "lock"`;

        const existingTrigger = await tx.myHrSyncTrigger.findUnique({
          where: { triggerId: payload.triggerId },
        });
        if (existingTrigger)
          return { outcome: 'DUPLICATE', jobId: existingTrigger.jobId };

        const trigger = await tx.myHrSyncTrigger.create({
          data: {
            triggerId: payload.triggerId,
            source: payload.source as MyHrTriggerSourceEnum,
            scheduledFor,
          },
        });

        const activeJob = await tx.myHrSyncJob.findFirst({
          where: { status: MyHrJobStatus.PROCESSING },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        });
        if (activeJob) {
          await tx.myHrSyncTrigger.update({
            where: { id: trigger.id },
            data: {
              outcome: MyHrTriggerOutcome.COALESCED,
              jobId: activeJob.id,
            },
          });
          return { outcome: MyHrTriggerOutcome.COALESCED, jobId: activeJob.id };
        }

        const attendanceRecords = await tx.attendanceRecord.findMany({
          where: { myHrSyncRecord: { is: null } },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: getPositiveInteger(this.config, 'MYHR_JOB_RECORD_LIMIT', 5_000),
          select: {
            id: true,
            userId: true,
            logDate: true,
            logType: true,
            createdAt: true,
            storeSyncRecords: { select: { store: { select: { name: true } } } },
          },
        });

        if (attendanceRecords.length === 0) {
          await tx.myHrSyncTrigger.update({
            where: { id: trigger.id },
            data: { outcome: MyHrTriggerOutcome.NO_RECORDS },
          });
          return { outcome: MyHrTriggerOutcome.NO_RECORDS, jobId: null };
        }

        const sync = await tx.myHrSync.upsert({
          where: { id: 'myhr-sync' },
          create: { id: 'myhr-sync' },
          update: {},
        });
        const firstRecord = attendanceRecords[0];
        const lastRecord = attendanceRecords[attendanceRecords.length - 1];
        const job = await tx.myHrSyncJob.create({
          data: {
            myHrSyncId: sync.id,
            status: MyHrJobStatus.PROCESSING,
            totalRecords: attendanceRecords.length,
            startedAt: new Date(),
            startDate: firstRecord.createdAt,
            startRecordId: firstRecord.id,
            endDate: lastRecord.createdAt,
            endRecordId: lastRecord.id,
          },
        });

        await tx.myHrSyncTrigger.update({
          where: { id: trigger.id },
          data: { outcome: MyHrTriggerOutcome.CREATED, jobId: job.id },
        });

        const validRecords: MyHrSyncPayload[] = [];
        const invalidRecords: { id: string; error: string }[] = [];
        for (const record of attendanceRecords) {
          try {
            validRecords.push({
              attendanceRecordId: record.id,
              ...mapAttendanceToMyHr({
                userId: record.userId,
                logDate: record.logDate,
                logType: record.logType,
                location: record.storeSyncRecords.store.name,
              }),
            });
          } catch (error) {
            invalidRecords.push({
              id: record.id,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        let sequence = 0;
        const chunkSize = getPositiveInteger(
          this.config,
          'MYHR_CHUNK_SIZE',
          500,
        );
        for (let index = 0; index < validRecords.length; index += chunkSize) {
          const sourceChunk = validRecords.slice(index, index + chunkSize);
          const payloadChunk = sourceChunk.map((record) => ({
            empid: record.empid,
            logdt: record.logdt,
            logtm: record.logtm,
            logstats: record.logstats,
            location: record.location,
          }));
          const chunk = await tx.myHrSyncChunk.create({
            data: {
              myHrSyncJobId: job.id,
              sequence,
              status: MyHrChunkStatus.PENDING,
              totalRecords: sourceChunk.length,
              payload: payloadChunk,
              payloadHash: this.hashPayload(payloadChunk),
            },
          });
          await tx.myHrAttendanceSync.createMany({
            data: sourceChunk.map((record) => ({
              attendanceRecordId: record.attendanceRecordId,
              chunkId: chunk.id,
              status: MyHrRecordSyncStatus.PENDING,
            })),
            skipDuplicates: true,
          });
          await this.enqueueChunk(tx, chunk.id, `chunk:${chunk.id}`);
          sequence += 1;
        }

        if (invalidRecords.length > 0) {
          const invalidPayload: Prisma.InputJsonArray = [];
          const failedChunk = await tx.myHrSyncChunk.create({
            data: {
              myHrSyncJobId: job.id,
              sequence,
              status: MyHrChunkStatus.FAILED,
              totalRecords: invalidRecords.length,
              failedRecords: invalidRecords.length,
              payload: invalidPayload,
              payloadHash: this.hashPayload(invalidPayload),
              completedAt: new Date(),
              errorMessage:
                'One or more records have an unsupported punch value',
            },
          });
          await tx.myHrAttendanceSync.createMany({
            data: invalidRecords.map((record) => ({
              attendanceRecordId: record.id,
              chunkId: failedChunk.id,
              status: MyHrRecordSyncStatus.FAILED,
              errorMessage: record.error,
            })),
            skipDuplicates: true,
          });
        }

        return { outcome: MyHrTriggerOutcome.CREATED, jobId: job.id };
      },
      {
        timeout: getPositiveInteger(
          this.config,
          'MYHR_JOB_TRANSACTION_TIMEOUT_MS',
          120_000,
        ),
      },
    );

    if (result.jobId) await this.finalizeJob(result.jobId);
    this.logger.log(
      `event=myhr_trigger_processed triggerId=${payload.triggerId} outcome=${result.outcome} jobId=${result.jobId ?? 'none'}`,
    );
  }

  async processChunk(chunkId: string): Promise<void> {
    const chunk = await this.prisma.myHrSyncChunk.findUnique({
      where: { id: chunkId },
    });
    if (!chunk) throw new Error(`MyHR sync chunk not found: ${chunkId}`);

    if (chunk.status === MyHrChunkStatus.VERIFYING && chunk.batchId) {
      await this.ensureStatusCheck(
        chunk.id,
        chunk.batchId,
        chunk.statusCheckAttemptCount,
      );
      return;
    }
    if (
      chunk.status === MyHrChunkStatus.SUCCESS ||
      chunk.status === MyHrChunkStatus.FAILED ||
      chunk.status === MyHrChunkStatus.UNKNOWN
    ) {
      await this.finalizeJob(chunk.myHrSyncJobId);
      return;
    }
    if (chunk.status === MyHrChunkStatus.UPLOADING) {
      if (chunk.leaseExpiresAt && chunk.leaseExpiresAt <= new Date()) {
        await this.markUnknown(
          chunk.id,
          chunk.myHrSyncJobId,
          'Upload worker lease expired after the request may have started',
        );
      }
      return;
    }

    let payload: MyHrPayload[];
    try {
      payload = parseMyHrPayload(chunk.payload);
      if (
        chunk.payloadHash.length === 64 &&
        chunk.payloadHash !== this.hashPayload(chunk.payload)
      ) {
        throw new Error('Stored MyHR chunk payload hash does not match');
      }
    } catch (error) {
      await this.markFailed(
        chunk.id,
        chunk.myHrSyncJobId,
        this.errorMessage(error),
      );
      return;
    }
    await this.client.prepare();
    const claim = await this.claimChunk(chunk.id);
    if (!claim) return;

    let uploadResult: { batchId: string };
    try {
      uploadResult = await this.client.upload(payload);
    } catch (error) {
      await this.handleUploadError(chunk, claim, error);
      return;
    }

    await this.acceptUpload(chunk, claim, uploadResult.batchId);
  }

  async checkBatch(chunkId: string, batchId: string): Promise<void> {
    const chunk = await this.prisma.myHrSyncChunk.findUnique({
      where: { id: chunkId },
    });
    if (!chunk) throw new Error(`MyHR sync chunk not found: ${chunkId}`);
    if (
      chunk.status !== MyHrChunkStatus.VERIFYING ||
      chunk.batchId !== batchId
    ) {
      await this.finalizeJob(chunk.myHrSyncJobId);
      return;
    }
    if (
      chunk.verificationDeadline &&
      chunk.verificationDeadline <= new Date()
    ) {
      await this.markUnknown(
        chunk.id,
        chunk.myHrSyncJobId,
        'MyHR batch verification exceeded its deadline',
      );
      return;
    }

    let result: Awaited<ReturnType<MyHrClient['getBatchStatus']>>;
    try {
      result = await this.client.getBatchStatus(batchId);
    } catch (error) {
      if (error instanceof MyHrClientError && error.kind === 'AMBIGUOUS') {
        await this.markUnknown(
          chunk.id,
          chunk.myHrSyncJobId,
          this.errorMessage(error),
        );
        return;
      }
      this.logger.warn(
        `event=myhr_status_check_failed jobId=${chunk.myHrSyncJobId} chunkId=${chunk.id} batchId=${batchId} attempt=${chunk.statusCheckAttemptCount + 1}`,
      );
      await this.scheduleNextStatusCheck(chunk, this.errorMessage(error));
      return;
    }

    if (result.status === 'PENDING') {
      await this.scheduleNextStatusCheck(chunk, null);
      return;
    }
    if (result.status === 'UNKNOWN') {
      const response = sanitizeExternalText(JSON.stringify(result.raw));
      await this.markUnknown(
        chunk.id,
        chunk.myHrSyncJobId,
        `MyHR returned an unrecognized batch status: ${response}`,
      );
      return;
    }

    if (result.status === 'FAILED') {
      await this.markFailed(
        chunk.id,
        chunk.myHrSyncJobId,
        'MyHR reported that the batch failed',
      );
      return;
    }

    await this.confirmBatchSuccess(chunk, batchId);
  }

  async reconcile(): Promise<void> {
    const pending = await this.prisma.myHrSyncChunk.findMany({
      where: { status: MyHrChunkStatus.PENDING },
      select: { id: true, uploadAttemptCount: true },
      take: 100,
    });
    for (const chunk of pending) {
      await this.enqueueChunk(
        this.prisma,
        chunk.id,
        `chunk:${chunk.id}:reconcile:${chunk.uploadAttemptCount}`,
      );
    }

    const verifying = await this.prisma.myHrSyncChunk.findMany({
      where: { status: MyHrChunkStatus.VERIFYING, batchId: { not: null } },
      select: { id: true, batchId: true, statusCheckAttemptCount: true },
      take: 100,
    });
    for (const chunk of verifying) {
      if (chunk.batchId) {
        await this.ensureStatusCheck(
          chunk.id,
          chunk.batchId,
          chunk.statusCheckAttemptCount,
        );
      }
    }

    const expired = await this.prisma.myHrSyncChunk.findMany({
      where: {
        status: MyHrChunkStatus.UPLOADING,
        leaseExpiresAt: { lte: new Date() },
      },
      select: { id: true, myHrSyncJobId: true },
      take: 100,
    });
    for (const chunk of expired) {
      await this.markUnknown(
        chunk.id,
        chunk.myHrSyncJobId,
        'Upload lease expired with an uncertain remote outcome',
      );
    }

    const activeJobs = await this.prisma.myHrSyncJob.findMany({
      where: { status: MyHrJobStatus.PROCESSING },
      select: { id: true },
      take: 100,
    });
    for (const job of activeJobs) await this.finalizeJob(job.id);

    await this.logHealthSignals();

    const retentionDate = new Date(
      Date.now() -
        getPositiveInteger(this.config, 'MYHR_RETENTION_DAYS', 30) * 86_400_000,
    );
    await this.prisma.myHrOutbox.deleteMany({
      where: { publishedAt: { not: null, lt: retentionDate } },
    });
    await this.prisma.myHrSyncChunk.updateMany({
      where: {
        completedAt: { lt: retentionDate },
        payloadPurgedAt: null,
        status: {
          in: [
            MyHrChunkStatus.SUCCESS,
            MyHrChunkStatus.FAILED,
            MyHrChunkStatus.UNKNOWN,
          ],
        },
      },
      data: { payload: { purged: true }, payloadPurgedAt: new Date() },
    });
  }

  private async logHealthSignals(): Promise<void> {
    const [unknownCount, overdueVerificationCount, oldestOutbox, activeJob] =
      await Promise.all([
        this.prisma.myHrSyncChunk.count({
          where: { status: MyHrChunkStatus.UNKNOWN },
        }),
        this.prisma.myHrSyncChunk.count({
          where: {
            status: MyHrChunkStatus.VERIFYING,
            verificationDeadline: { lte: new Date() },
          },
        }),
        this.prisma.myHrOutbox.findFirst({
          where: { publishedAt: null },
          orderBy: { availableAt: 'asc' },
          select: { id: true, availableAt: true, attemptCount: true },
        }),
        this.prisma.myHrSyncJob.findFirst({
          where: { status: MyHrJobStatus.PROCESSING },
          orderBy: { startedAt: 'asc' },
          select: { id: true, startedAt: true },
        }),
      ]);

    if (unknownCount > 0) {
      this.logger.warn(`event=myhr_unknown_chunks count=${unknownCount}`);
    }
    if (overdueVerificationCount > 0) {
      this.logger.warn(
        `event=myhr_verification_overdue count=${overdueVerificationCount}`,
      );
    }
    const outboxWarnMs =
      getPositiveInteger(this.config, 'MYHR_OUTBOX_WARN_MINUTES', 5) * 60_000;
    if (
      oldestOutbox &&
      oldestOutbox.availableAt.getTime() < Date.now() - outboxWarnMs
    ) {
      this.logger.warn(
        `event=myhr_outbox_stale outboxId=${oldestOutbox.id} attempts=${oldestOutbox.attemptCount} availableAt=${oldestOutbox.availableAt.toISOString()}`,
      );
    }
    const activeWarnMs =
      getPositiveInteger(this.config, 'MYHR_ACTIVE_JOB_WARN_MINUTES', 120) *
      60_000;
    if (
      activeJob?.startedAt &&
      activeJob.startedAt.getTime() < Date.now() - activeWarnMs
    ) {
      this.logger.warn(
        `event=myhr_active_job_stale jobId=${activeJob.id} startedAt=${activeJob.startedAt.toISOString()}`,
      );
    }
  }

  async getTrigger(triggerId: string) {
    const trigger = await this.prisma.myHrSyncTrigger.findUnique({
      where: { triggerId },
      include: { job: true },
    });
    if (!trigger) {
      throw new NotFoundException(`MyHR sync trigger not found: ${triggerId}`);
    }
    return trigger;
  }

  async getJob(jobId: string) {
    const job = await this.prisma.myHrSyncJob.findUnique({
      where: { id: jobId },
      include: { chunks: { orderBy: { sequence: 'asc' } }, triggers: true },
    });
    if (!job) throw new NotFoundException(`MyHR sync job not found: ${jobId}`);
    return job;
  }

  listUnknownChunks() {
    return this.prisma.myHrSyncChunk.findMany({
      where: { status: MyHrChunkStatus.UNKNOWN },
      orderBy: { updatedAt: 'asc' },
      include: {
        uploadAttempts: { orderBy: { attemptNumber: 'desc' }, take: 1 },
      },
    });
  }

  async attachBatch(chunkId: string, batchId: string): Promise<void> {
    const chunk = await this.prisma.myHrSyncChunk.findUnique({
      where: { id: chunkId },
      select: { id: true, status: true, myHrSyncJobId: true },
    });
    if (!chunk) throw new NotFoundException(`MyHR chunk not found: ${chunkId}`);
    if (chunk.status !== MyHrChunkStatus.UNKNOWN) {
      throw new ConflictException(`MyHR chunk ${chunkId} is not UNKNOWN`);
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.reopenJob(tx, chunk.myHrSyncJobId);
      const result = await tx.myHrSyncChunk.updateMany({
        where: { id: chunkId, status: MyHrChunkStatus.UNKNOWN },
        data: {
          status: MyHrChunkStatus.VERIFYING,
          batchId,
          verificationDeadline: this.verificationDeadline(),
          errorMessage: null,
        },
      });
      if (result.count === 0) return false;
      await tx.myHrAttendanceSync.updateMany({
        where: { chunkId, status: MyHrRecordSyncStatus.UNKNOWN },
        data: {
          status: MyHrRecordSyncStatus.VERIFYING,
          batchId,
          errorMessage: null,
        },
      });
      await this.enqueueStatusCheck(tx, chunkId, batchId, 0, new Date());
      return true;
    });
    if (!updated)
      throw new ConflictException(`MyHR chunk ${chunkId} is not UNKNOWN`);
  }

  async retryUnknown(chunkId: string, acknowledged: boolean): Promise<void> {
    if (!acknowledged) {
      throw new ConflictException('Duplicate-risk acknowledgement is required');
    }
    const chunk = await this.prisma.myHrSyncChunk.findUnique({
      where: { id: chunkId },
    });
    if (!chunk || chunk.status !== MyHrChunkStatus.UNKNOWN) {
      throw new ConflictException(`MyHR chunk ${chunkId} is not UNKNOWN`);
    }
    await this.prisma.$transaction(async (tx) => {
      await this.reopenJob(tx, chunk.myHrSyncJobId);
      await tx.myHrSyncChunk.update({
        where: { id: chunkId },
        data: {
          status: MyHrChunkStatus.PENDING,
          batchId: null,
          claimToken: null,
          leaseExpiresAt: null,
          verificationDeadline: null,
          completedAt: null,
          errorMessage: null,
        },
      });
      await tx.myHrAttendanceSync.updateMany({
        where: { chunkId },
        data: {
          status: MyHrRecordSyncStatus.PENDING,
          batchId: null,
          startedAt: null,
          errorMessage: null,
        },
      });
      await this.enqueueChunk(
        tx,
        chunkId,
        `chunk:${chunkId}:operator:${chunk.uploadAttemptCount + 1}`,
      );
    });
  }

  async failUnknown(chunkId: string, reason: string): Promise<void> {
    const chunk = await this.prisma.myHrSyncChunk.findUnique({
      where: { id: chunkId },
    });
    if (!chunk) throw new NotFoundException(`MyHR chunk not found: ${chunkId}`);
    if (chunk.status !== MyHrChunkStatus.UNKNOWN) {
      throw new ConflictException(`MyHR chunk ${chunkId} is not UNKNOWN`);
    }
    await this.markFailed(chunk.id, chunk.myHrSyncJobId, reason);
  }

  private async reopenJob(tx: TransactionClient, jobId: string): Promise<void> {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('obdc:myhr:job'))::text AS "lock"`;
    const activeJob = await tx.myHrSyncJob.findFirst({
      where: { status: MyHrJobStatus.PROCESSING, id: { not: jobId } },
      select: { id: true },
    });
    if (activeJob) {
      throw new ConflictException(
        `Cannot reconcile while MyHR job ${activeJob.id} is processing`,
      );
    }
    await tx.myHrSyncJob.update({
      where: { id: jobId },
      data: { status: MyHrJobStatus.PROCESSING, completedAt: null },
    });
  }

  private async claimChunk(chunkId: string): Promise<ClaimedUpload | null> {
    return this.prisma.$transaction(async (tx) => {
      const chunk = await tx.myHrSyncChunk.findUnique({
        where: { id: chunkId },
      });
      if (!chunk || chunk.status !== MyHrChunkStatus.PENDING) return null;
      const claimToken = randomUUID();
      const attemptNumber = chunk.uploadAttemptCount + 1;
      const claimed = await tx.myHrSyncChunk.updateMany({
        where: { id: chunkId, status: MyHrChunkStatus.PENDING },
        data: {
          status: MyHrChunkStatus.UPLOADING,
          claimToken,
          leaseExpiresAt: new Date(
            Date.now() +
              getPositiveInteger(
                this.config,
                'MYHR_UPLOAD_LEASE_SECONDS',
                120,
              ) *
                1_000,
          ),
          uploadAttemptCount: { increment: 1 },
          startedAt: new Date(),
          completedAt: null,
          errorMessage: null,
        },
      });
      if (claimed.count === 0) return null;
      await tx.myHrAttendanceSync.updateMany({
        where: { chunkId, status: MyHrRecordSyncStatus.PENDING },
        data: {
          status: MyHrRecordSyncStatus.UPLOADING,
          attemptCount: { increment: 1 },
          startedAt: new Date(),
          errorMessage: null,
        },
      });
      const attempt = await tx.myHrUploadAttempt.create({
        data: {
          chunkId,
          attemptNumber,
          status: MyHrUploadAttemptStatus.REQUEST_STARTED,
          requestStartedAt: new Date(),
        },
      });
      return { attemptId: attempt.id, attemptNumber, claimToken };
    });
  }

  private async acceptUpload(
    chunk: { id: string; myHrSyncJobId: string },
    claim: ClaimedUpload,
    batchId: string,
  ): Promise<void> {
    const retainedOwnership = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.myHrSyncChunk.updateMany({
        where: {
          id: chunk.id,
          status: MyHrChunkStatus.UPLOADING,
          claimToken: claim.claimToken,
        },
        data: {
          status: MyHrChunkStatus.VERIFYING,
          batchId,
          claimToken: null,
          leaseExpiresAt: null,
          verificationDeadline: this.verificationDeadline(),
          errorMessage: null,
        },
      });
      await tx.myHrUploadAttempt.update({
        where: { id: claim.attemptId },
        data: {
          status: MyHrUploadAttemptStatus.ACCEPTED,
          batchId,
          responseRecordedAt: new Date(),
        },
      });
      if (updated.count === 0) return false;
      await tx.myHrAttendanceSync.updateMany({
        where: { chunkId: chunk.id, status: MyHrRecordSyncStatus.UPLOADING },
        data: { status: MyHrRecordSyncStatus.VERIFYING, batchId },
      });
      await this.enqueueStatusCheck(tx, chunk.id, batchId, 0, new Date());
      return true;
    });
    if (!retainedOwnership) {
      this.logger.warn(
        `event=myhr_upload_ownership_lost jobId=${chunk.myHrSyncJobId} chunkId=${chunk.id} batchId=${batchId}`,
      );
      return;
    }
    this.logger.log(
      `event=myhr_upload_accepted jobId=${chunk.myHrSyncJobId} chunkId=${chunk.id} batchId=${batchId}`,
    );
  }

  private async handleUploadError(
    chunk: { id: string; myHrSyncJobId: string; totalRecords: number },
    claim: ClaimedUpload,
    error: unknown,
  ): Promise<void> {
    const message = this.errorMessage(error);
    const kind = error instanceof MyHrClientError ? error.kind : 'AMBIGUOUS';
    this.logger.warn(
      `event=myhr_upload_failed jobId=${chunk.myHrSyncJobId} chunkId=${chunk.id} uploadAttempt=${claim.attemptNumber} outcome=${kind}`,
    );
    if (kind === 'RETRYABLE') {
      if (
        claim.attemptNumber >=
        getPositiveInteger(this.config, 'MYHR_MAX_UPLOAD_ATTEMPTS', 3)
      ) {
        await this.prisma.$transaction(async (tx) => {
          await tx.myHrUploadAttempt.update({
            where: { id: claim.attemptId },
            data: {
              status: MyHrUploadAttemptStatus.REJECTED,
              responseRecordedAt: new Date(),
              errorMessage: message,
            },
          });
          const updated = await tx.myHrSyncChunk.updateMany({
            where: {
              id: chunk.id,
              status: MyHrChunkStatus.UPLOADING,
              claimToken: claim.claimToken,
            },
            data: {
              status: MyHrChunkStatus.FAILED,
              failedRecords: chunk.totalRecords,
              completedAt: new Date(),
              claimToken: null,
              leaseExpiresAt: null,
              errorMessage: message,
            },
          });
          if (updated.count === 0) return;
          await tx.myHrAttendanceSync.updateMany({
            where: {
              chunkId: chunk.id,
              status: MyHrRecordSyncStatus.UPLOADING,
            },
            data: {
              status: MyHrRecordSyncStatus.FAILED,
              startedAt: null,
              errorMessage: message,
            },
          });
        });
        await this.finalizeJob(chunk.myHrSyncJobId);
        return;
      }
      const delaySeconds = Math.min(
        900,
        30 * 2 ** Math.min(claim.attemptNumber - 1, 5),
      );
      await this.prisma.$transaction(async (tx) => {
        await tx.myHrUploadAttempt.update({
          where: { id: claim.attemptId },
          data: {
            status: MyHrUploadAttemptStatus.REJECTED,
            responseRecordedAt: new Date(),
            errorMessage: message,
          },
        });
        const updated = await tx.myHrSyncChunk.updateMany({
          where: {
            id: chunk.id,
            status: MyHrChunkStatus.UPLOADING,
            claimToken: claim.claimToken,
          },
          data: {
            status: MyHrChunkStatus.PENDING,
            claimToken: null,
            leaseExpiresAt: null,
            errorMessage: message,
          },
        });
        if (updated.count === 0) return;
        await tx.myHrAttendanceSync.updateMany({
          where: { chunkId: chunk.id, status: MyHrRecordSyncStatus.UPLOADING },
          data: {
            status: MyHrRecordSyncStatus.PENDING,
            startedAt: null,
            errorMessage: message,
          },
        });
        await this.enqueueChunk(
          tx,
          chunk.id,
          `chunk:${chunk.id}:retry:${claim.attemptNumber}`,
          new Date(Date.now() + delaySeconds * 1_000),
        );
      });
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.myHrUploadAttempt.update({
        where: { id: claim.attemptId },
        data: {
          status:
            kind === 'DEFINITIVE'
              ? MyHrUploadAttemptStatus.REJECTED
              : MyHrUploadAttemptStatus.UNKNOWN,
          responseRecordedAt: new Date(),
          errorMessage: message,
        },
      });
      const updated = await tx.myHrSyncChunk.updateMany({
        where: {
          id: chunk.id,
          status: MyHrChunkStatus.UPLOADING,
          claimToken: claim.claimToken,
        },
        data: {
          status:
            kind === 'DEFINITIVE'
              ? MyHrChunkStatus.FAILED
              : MyHrChunkStatus.UNKNOWN,
          failedRecords: kind === 'DEFINITIVE' ? chunk.totalRecords : 0,
          completedAt: new Date(),
          claimToken: null,
          leaseExpiresAt: null,
          errorMessage: message,
        },
      });
      if (updated.count === 0) return;
      await tx.myHrAttendanceSync.updateMany({
        where: { chunkId: chunk.id, status: MyHrRecordSyncStatus.UPLOADING },
        data: {
          status:
            kind === 'DEFINITIVE'
              ? MyHrRecordSyncStatus.FAILED
              : MyHrRecordSyncStatus.UNKNOWN,
          startedAt: null,
          errorMessage: message,
        },
      });
    });
    await this.finalizeJob(chunk.myHrSyncJobId);
  }

  private async confirmBatchSuccess(
    chunk: { id: string; myHrSyncJobId: string; payload: Prisma.JsonValue },
    batchId: string,
  ): Promise<void> {
    const payload = parseMyHrPayload(chunk.payload);
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.myHrSyncChunk.updateMany({
        where: { id: chunk.id, status: MyHrChunkStatus.VERIFYING, batchId },
        data: {
          status: MyHrChunkStatus.SUCCESS,
          insertedRecords: payload.length,
          failedRecords: 0,
          completedAt: new Date(),
          errorMessage: null,
        },
      });
      if (updated.count === 0) return;
      await tx.myHRBatch.upsert({
        where: { id: batchId },
        create: { id: batchId },
        update: {},
      });
      await tx.biometricRecord.createMany({
        data: payload.map((record) => ({
          empid: record.empid,
          logdt: record.logdt,
          logtm: record.logtm,
          logstats: mapMyHrLogStats(record.logstats),
          location: record.location,
          batchID: batchId,
        })),
      });
      await tx.myHrAttendanceSync.updateMany({
        where: { chunkId: chunk.id, status: MyHrRecordSyncStatus.VERIFYING },
        data: {
          status: MyHrRecordSyncStatus.SYNCED,
          batchId,
          syncedAt: new Date(),
          errorMessage: null,
        },
      });
    });
    await this.finalizeJob(chunk.myHrSyncJobId);
  }

  private async scheduleNextStatusCheck(
    chunk: {
      id: string;
      batchId: string | null;
      statusCheckAttemptCount: number;
      verificationDeadline: Date | null;
      myHrSyncJobId: string;
    },
    errorMessage: string | null,
  ): Promise<void> {
    if (!chunk.batchId) {
      await this.markUnknown(
        chunk.id,
        chunk.myHrSyncJobId,
        'Verifying chunk has no batchId',
      );
      return;
    }
    if (
      chunk.verificationDeadline &&
      chunk.verificationDeadline <= new Date()
    ) {
      await this.markUnknown(
        chunk.id,
        chunk.myHrSyncJobId,
        'Batch verification timed out',
      );
      return;
    }
    const nextAttempt = chunk.statusCheckAttemptCount + 1;
    const delaySeconds = Math.min(900, 30 * 2 ** Math.min(nextAttempt - 1, 5));
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.myHrSyncChunk.updateMany({
        where: { id: chunk.id, status: MyHrChunkStatus.VERIFYING },
        data: {
          statusCheckAttemptCount: { increment: 1 },
          errorMessage,
        },
      });
      if (updated.count === 0) return;
      await this.enqueueStatusCheck(
        tx,
        chunk.id,
        chunk.batchId as string,
        nextAttempt,
        new Date(Date.now() + delaySeconds * 1_000),
      );
    });
  }

  private async ensureStatusCheck(
    chunkId: string,
    batchId: string,
    attempt: number,
  ): Promise<void> {
    await this.enqueueStatusCheck(
      this.prisma,
      chunkId,
      batchId,
      attempt,
      new Date(),
    );
  }

  private async markUnknown(
    chunkId: string,
    jobId: string,
    errorMessage: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.myHrSyncChunk.updateMany({
        where: {
          id: chunkId,
          status: {
            in: [MyHrChunkStatus.UPLOADING, MyHrChunkStatus.VERIFYING],
          },
        },
        data: {
          status: MyHrChunkStatus.UNKNOWN,
          claimToken: null,
          leaseExpiresAt: null,
          completedAt: new Date(),
          errorMessage,
        },
      });
      if (updated.count === 0) return;
      await tx.myHrAttendanceSync.updateMany({
        where: {
          chunkId,
          status: {
            in: [
              MyHrRecordSyncStatus.UPLOADING,
              MyHrRecordSyncStatus.VERIFYING,
            ],
          },
        },
        data: {
          status: MyHrRecordSyncStatus.UNKNOWN,
          startedAt: null,
          errorMessage,
        },
      });
      await tx.myHrUploadAttempt.updateMany({
        where: {
          chunkId,
          status: MyHrUploadAttemptStatus.REQUEST_STARTED,
        },
        data: {
          status: MyHrUploadAttemptStatus.UNKNOWN,
          responseRecordedAt: new Date(),
          errorMessage,
        },
      });
    });
    await this.finalizeJob(jobId);
    this.logger.warn(
      `event=myhr_chunk_unknown jobId=${jobId} chunkId=${chunkId}`,
    );
  }

  private async markFailed(
    chunkId: string,
    jobId: string,
    errorMessage: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const chunk = await tx.myHrSyncChunk.findUnique({
        where: { id: chunkId },
      });
      if (!chunk) return;
      const updated = await tx.myHrSyncChunk.updateMany({
        where: { id: chunkId, status: { not: MyHrChunkStatus.SUCCESS } },
        data: {
          status: MyHrChunkStatus.FAILED,
          failedRecords: chunk.totalRecords,
          claimToken: null,
          leaseExpiresAt: null,
          completedAt: new Date(),
          errorMessage,
        },
      });
      if (updated.count === 0) return;
      await tx.myHrAttendanceSync.updateMany({
        where: { chunkId, status: { not: MyHrRecordSyncStatus.SYNCED } },
        data: {
          status: MyHrRecordSyncStatus.FAILED,
          startedAt: null,
          errorMessage,
        },
      });
    });
    await this.finalizeJob(jobId);
    this.logger.warn(
      `event=myhr_chunk_failed jobId=${jobId} chunkId=${chunkId}`,
    );
  }

  private async finalizeJob(jobId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "MyHrSyncJob" WHERE "id" = ${jobId} FOR UPDATE`;
      const job = await tx.myHrSyncJob.findUnique({
        where: { id: jobId },
        include: { chunks: true },
      });
      if (!job) return;

      const summary = deriveMyHrJobSummary(job.chunks);
      await tx.myHrSyncJob.update({
        where: { id: jobId },
        data: {
          status: summary.status,
          insertedRecords: summary.successfulRecords,
          failedRecords: summary.failedRecords,
          reviewRecords: summary.reviewRecords,
          completedAt:
            summary.status === MyHrJobStatus.PROCESSING ? null : new Date(),
          errorMessage: summary.errorMessage,
        },
      });

      if (summary.status === MyHrJobStatus.SUCCESS) {
        await tx.myHrSync.update({
          where: { id: job.myHrSyncId },
          data: { lastSyncedAt: new Date() },
        });
      }
      if (summary.status !== MyHrJobStatus.PROCESSING) {
        const remaining = await tx.attendanceRecord.count({
          where: { myHrSyncRecord: { is: null } },
        });
        if (remaining > 0) await this.enqueueContinuation(tx, jobId);
      }
    });
  }

  private async enqueueChunk(
    tx: TransactionClient | PrismaService,
    chunkId: string,
    dedupKey: string,
    availableAt = new Date(),
  ): Promise<void> {
    const message: VersionedQueueMessage<
      'SYNC_MY_HR_CHUNK',
      { chunkId: string }
    > = {
      version: 1,
      type: 'SYNC_MY_HR_CHUNK',
      payload: { chunkId },
      createdAt: new Date().toISOString(),
    };
    await this.enqueue(
      tx,
      dedupKey,
      MyHrOutboxMessageType.SYNC_MY_HR_CHUNK,
      message,
      availableAt,
    );
  }

  private async enqueueStatusCheck(
    tx: TransactionClient | PrismaService,
    chunkId: string,
    batchId: string,
    attempt: number,
    availableAt: Date,
  ): Promise<void> {
    const message: VersionedQueueMessage<
      'CHECK_MY_HR_BATCH',
      { chunkId: string; batchId: string }
    > = {
      version: 1,
      type: 'CHECK_MY_HR_BATCH',
      payload: { chunkId, batchId },
      createdAt: new Date().toISOString(),
    };
    await this.enqueue(
      tx,
      `status:${chunkId}:${attempt}`,
      MyHrOutboxMessageType.CHECK_MY_HR_BATCH,
      message,
      availableAt,
    );
  }

  private async enqueueContinuation(
    tx: TransactionClient,
    jobId: string,
  ): Promise<void> {
    const now = new Date();
    const message: VersionedQueueMessage<
      'START_MY_HR_SYNC',
      StartMyHrSyncMessage
    > = {
      version: 1,
      type: 'START_MY_HR_SYNC',
      payload: {
        triggerId: `myhr:continuation:${jobId}`,
        source: 'CONTINUATION',
        scheduledFor: now.toISOString(),
      },
      createdAt: now.toISOString(),
    };
    await this.enqueue(
      tx,
      `continuation:${jobId}`,
      MyHrOutboxMessageType.START_MY_HR_SYNC,
      message,
      now,
    );
  }

  private async enqueue(
    tx: TransactionClient | PrismaService,
    dedupKey: string,
    messageType: MyHrOutboxMessageType,
    payload: object,
    availableAt: Date,
  ): Promise<void> {
    await tx.myHrOutbox.upsert({
      where: { dedupKey },
      create: {
        dedupKey,
        messageType,
        payload: payload as Prisma.InputJsonObject,
        availableAt,
      },
      update: {},
    });
  }

  private verificationDeadline(): Date {
    return new Date(
      Date.now() +
        getPositiveInteger(
          this.config,
          'MYHR_VERIFICATION_DEADLINE_HOURS',
          24,
        ) *
          3_600_000,
    );
  }

  private hashPayload(payload: unknown): string {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }

  private errorMessage(error: unknown): string {
    return sanitizeExternalText(
      error instanceof Error ? error.message : String(error),
    );
  }
}
