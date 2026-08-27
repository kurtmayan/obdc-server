import { Module } from '@nestjs/common';
import { FileSecurityService } from './file-security.service';

@Module({
  providers: [FileSecurityService],
  exports: [FileSecurityService],
})
export class FileSecurityModule {}