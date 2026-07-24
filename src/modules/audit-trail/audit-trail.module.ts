import { Module } from '@nestjs/common';
import { AuditTrailService } from './audit-trail.service';
import { AuditTrailInterceptor } from './interceptors/audit-trail.interceptor';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  providers: [AuditTrailService, AuditTrailInterceptor, PrismaService],
  exports: [AuditTrailService, AuditTrailInterceptor],
})
export class AuditTrailModule {}
