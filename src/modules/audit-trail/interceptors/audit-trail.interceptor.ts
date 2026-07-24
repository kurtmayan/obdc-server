import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { catchError, Observable, tap, throwError } from 'rxjs';
import type { Prisma } from 'src/generated/prisma/client';
import { AuditTrailService } from '../audit-trail.service';
import { AuditAction } from '../decorators/audit-action.decorator';
import type { JwtPayload } from 'jsonwebtoken';

type AuthenticatedRequest = Request & {
  user?: JwtPayload;
};

@Injectable()
export class AuditTrailInterceptor implements NestInterceptor {
  constructor(
    private readonly auditTrailService: AuditTrailService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    console.log('AUDIT REQUEST USER:', request.user);

    const response = context.switchToHttp().getResponse<Response>();

    const action =
      this.reflector.getAllAndOverride(AuditAction, [
        context.getHandler(),
        context.getClass(),
      ]) ?? `${request.method} ${request.route?.path ?? request.path}`;

    const payload = this.sanitizePayload({
      body: this.toJsonValue(request.body),
      params: this.toJsonValue(request.params),
      query: this.toJsonValue(request.query),
    });

    return next.handle().pipe(
      tap(() => {
        void this.auditTrailService.create({
          userId: request.user?.sub,
          userEmail: request.user?.email,
          action,
          method: request.method,
          endpoint: request.originalUrl,
          statusCode: response.statusCode,
          description: 'Request completed successfully',
          payload,
        });
      }),
      catchError((error: unknown) => {
        void this.auditTrailService.create({
          userId: request.user?.id,
          userEmail: request.user?.email,
          action,
          method: request.method,
          endpoint: request.originalUrl,
          statusCode: this.getStatusCode(error),
          description: this.getErrorMessage(error),
          payload,
        });

        return throwError(() => error);
      }),
    );
  }

  private getStatusCode(error: unknown): number {
    if (
      typeof error === 'object' &&
      error !== null &&
      'getStatus' in error &&
      typeof error.getStatus === 'function'
    ) {
      return error.getStatus();
    }

    return 500;
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Request failed';
  }

  private sanitizePayload(
    payload: Prisma.InputJsonObject,
  ): Prisma.InputJsonObject {
    const sensitiveFields = new Set([
      'password',
      'confirmPassword',
      'currentPassword',
      'newPassword',
      'token',
      'accessToken',
      'refreshToken',
      'otp',
      'secret',
      'authorization',
    ]);

    const sanitize = (value: Prisma.InputJsonValue): Prisma.InputJsonValue => {
      if (Array.isArray(value)) {
        return value.map((item) => sanitize(item));
      }

      if (value !== null && typeof value === 'object') {
        return Object.fromEntries(
          Object.entries(value).map(([key, nestedValue]) => [
            key,
            sensitiveFields.has(key.toLowerCase())
              ? '[REDACTED]'
              : sanitize(nestedValue as Prisma.InputJsonValue),
          ]),
        ) as Prisma.InputJsonObject;
      }

      return value;
    };

    return sanitize(payload) as Prisma.InputJsonObject;
  }

  private toJsonValue(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
  }
}
