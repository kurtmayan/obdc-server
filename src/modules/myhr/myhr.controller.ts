import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { Role } from 'src/generated/prisma/enums';
import { AuditAction } from '../audit-trail/audit-trail.decorator';
import { Roles } from '../roles/roles.decorator';
import { SchedulerService } from '../scheduler/scheduler.service';
import { GetMyHRRecordDto } from './dto/get-my-hr-record.dto';
import {
  AttachMyHrBatchDto,
  FailUnknownMyHrChunkDto,
  RetryUnknownMyHrChunkDto,
} from './dto/reconcile-myhr-chunk.dto';
import { MyHrService } from './myhr.service';
import { MyHrSyncService } from './myhr-sync.service';

@Controller('myhr')
export class MyHrController {
  constructor(
    private readonly service: MyHrService,
    private readonly schedulerService: SchedulerService,
    private readonly syncService: MyHrSyncService,
  ) {}

  @Get()
  getMyHRRecords(@Query() query: GetMyHRRecordDto) {
    return this.service.getMyHrRecord(query);
  }

  @Roles(Role.SUPERADMIN)
  @AuditAction('Trigger MyHR synchronization')
  @Post('sync')
  @HttpCode(HttpStatus.ACCEPTED)
  triggerSync() {
    return this.schedulerService.triggerManually();
  }

  @Roles(Role.SUPERADMIN)
  @Get('sync/triggers/:triggerId')
  getTrigger(@Param('triggerId') triggerId: string) {
    return this.syncService.getTrigger(triggerId);
  }

  @Roles(Role.SUPERADMIN)
  @Get('sync/jobs/:jobId')
  getJob(@Param('jobId') jobId: string) {
    return this.syncService.getJob(jobId);
  }

  @Roles(Role.SUPERADMIN)
  @Get('sync/chunks/unknown')
  listUnknownChunks() {
    return this.syncService.listUnknownChunks();
  }

  @Roles(Role.SUPERADMIN)
  @AuditAction('Attach MyHR batch to unknown chunk')
  @Post('sync/chunks/:chunkId/attach-batch')
  async attachBatch(
    @Param('chunkId') chunkId: string,
    @Body() body: AttachMyHrBatchDto,
  ) {
    await this.syncService.attachBatch(chunkId, body.batchId);
    return { chunkId, status: 'VERIFYING' };
  }

  @Roles(Role.SUPERADMIN)
  @AuditAction('Retry unknown MyHR chunk')
  @Post('sync/chunks/:chunkId/retry')
  async retryUnknown(
    @Param('chunkId') chunkId: string,
    @Body() body: RetryUnknownMyHrChunkDto,
  ) {
    await this.syncService.retryUnknown(chunkId, body.acknowledgeDuplicateRisk);
    return { chunkId, status: 'PENDING' };
  }

  @Roles(Role.SUPERADMIN)
  @AuditAction('Fail unknown MyHR chunk')
  @Post('sync/chunks/:chunkId/fail')
  async failUnknown(
    @Param('chunkId') chunkId: string,
    @Body() body: FailUnknownMyHrChunkDto,
  ) {
    await this.syncService.failUnknown(chunkId, body.reason);
    return { chunkId, status: 'FAILED' };
  }

  @Get('biometrics/:batchID')
  getBiometricRecords(@Param('batchID') batchID: string) {
    return this.service.getBiometricsByBatchId(batchID);
  }

  @Get('status/:batchID')
  getBatchStatus(@Param('batchID') batchID: string) {
    return this.service.getMyHRBatchStatus(batchID);
  }
}
