import { Reflector } from '@nestjs/core';

export const AuditAction = Reflector.createDecorator<string>();