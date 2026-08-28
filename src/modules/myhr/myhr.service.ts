import { PrismaService } from '../prisma/prisma.service';
import { SqsQueueService } from '../sqs-queue/sqs-queue.service';
import { FileSecurityService } from '../file-security/file-security.service';
import { Injectable } from '@nestjs/common';

@Injectable()
export class MyHrService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sqsQueueService: SqsQueueService,
    private readonly fileSecurity: FileSecurityService
  ) {}

  
}
