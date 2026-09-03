import { Module } from '@nestjs/common';
import { AuditTrailService } from './audit-trail.service';
import { AuditTrailInterceptor } from './audit-trail.interceptor';

@Module({
  providers: [AuditTrailService, AuditTrailInterceptor],
  exports: [AuditTrailService, AuditTrailInterceptor],
})
export class AuditTrailModule {}
