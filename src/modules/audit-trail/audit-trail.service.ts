import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from 'src/generated/prisma/client';

@Injectable()
export class AuditTrailService {
  private readonly logger = new Logger(AuditTrailService.name);

  constructor(private readonly prismaService: PrismaService) {}

  async create(data: Prisma.AuditTrailUncheckedCreateInput): Promise<void> {
    try {
      await this.prismaService.auditTrail.create({
        data,
      });
    } catch (error) {
      this.logger.error(
        'Failed to create audit trail',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
