import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MyHrPayload } from 'src/types/my-hr';
import {
  getCsvValues,
  getPositiveInteger,
  sanitizeExternalText,
} from './myhr-sync.config';

export type MyHrBatchStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'UNKNOWN';
export type MyHrClientErrorKind = 'RETRYABLE' | 'DEFINITIVE' | 'AMBIGUOUS';

export class MyHrClientError extends Error {
  constructor(
    message: string,
    readonly kind: MyHrClientErrorKind,
    readonly statusCode?: number,
  ) {
    super(message);
    this.name = MyHrClientError.name;
  }
}

@Injectable()
export class MyHrClient {
  private token: string | null = null;
  private tokenPromise: Promise<string> | null = null;

  constructor(private readonly config: ConfigService) {}

  async prepare(): Promise<void> {
    await this.getToken();
  }

  async upload(payload: MyHrPayload[]): Promise<{ batchId: string }> {
    if (payload.length === 0) {
      throw new MyHrClientError('MyHR payload is empty', 'DEFINITIVE');
    }

    let token = await this.getToken();
    let response = await this.requestUpload(payload, token);

    if (response.status === 401) {
      this.clearToken();
      token = await this.getToken();
      response = await this.requestUpload(payload, token);
    }

    const responseBody = await response.text();
    const safeBody = sanitizeExternalText(responseBody);

    if (response.status === 429) {
      throw new MyHrClientError(
        `MyHR upload rate limited: ${safeBody}`,
        'RETRYABLE',
        response.status,
      );
    }
    if (response.status === 400 || response.status === 422) {
      throw new MyHrClientError(
        `MyHR rejected upload: ${safeBody}`,
        'DEFINITIVE',
        response.status,
      );
    }
    if (response.status >= 500) {
      throw new MyHrClientError(
        `MyHR upload outcome is uncertain: ${response.status} ${safeBody}`,
        'AMBIGUOUS',
        response.status,
      );
    }
    if (!response.ok) {
      throw new MyHrClientError(
        `MyHR rejected upload: ${response.status} ${safeBody}`,
        'DEFINITIVE',
        response.status,
      );
    }

    const body = this.parseJson(responseBody);
    const batchId = this.readString(body, 'batchId');
    if (!batchId) {
      throw new MyHrClientError(
        'MyHR accepted the upload but returned no batchId',
        'AMBIGUOUS',
        response.status,
      );
    }

    return { batchId };
  }

  async getBatchStatus(batchId: string): Promise<{
    status: MyHrBatchStatus;
    raw: unknown;
  }> {
    let token = await this.getToken();
    let response = await this.fetchWithTimeout(
      `${this.apiUrl()}/api/biometric/upload/bulk/status/${encodeURIComponent(batchId)}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    if (response.status === 401) {
      this.clearToken();
      token = await this.getToken();
      response = await this.fetchWithTimeout(
        `${this.apiUrl()}/api/biometric/upload/bulk/status/${encodeURIComponent(batchId)}`,
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
        },
      );
    }

    const responseBody = await response.text();
    if (!response.ok) {
      throw new MyHrClientError(
        `MyHR status request failed: ${response.status} ${sanitizeExternalText(responseBody)}`,
        'RETRYABLE',
        response.status,
      );
    }

    const raw = this.parseJson(responseBody);
    return { status: this.normalizeBatchStatus(raw), raw };
  }

  private async requestUpload(
    payload: MyHrPayload[],
    token: string,
  ): Promise<Response> {
    try {
      return await this.fetchWithTimeout(
        `${this.apiUrl()}/api/biometric/upload/bulk`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        },
      );
    } catch (error) {
      throw new MyHrClientError(
        `MyHR upload outcome is uncertain: ${error instanceof Error ? error.message : String(error)}`,
        'AMBIGUOUS',
      );
    }
  }

  private async getToken(): Promise<string> {
    if (this.token) return this.token;
    if (this.tokenPromise) return this.tokenPromise;

    this.tokenPromise = this.authenticate();
    try {
      this.token = await this.tokenPromise;
      return this.token;
    } finally {
      this.tokenPromise = null;
    }
  }

  private clearToken(): void {
    this.token = null;
  }

  private async authenticate(): Promise<string> {
    let response: Response;
    try {
      response = await this.fetchWithTimeout(`${this.apiUrl()}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: this.config.getOrThrow<string>('MYHR_USERNAME'),
          password: this.config.getOrThrow<string>('MYHR_PASSWORD'),
        }),
      });
    } catch (error) {
      throw new MyHrClientError(
        `MyHR authentication unavailable: ${error instanceof Error ? error.message : String(error)}`,
        'RETRYABLE',
      );
    }

    const responseBody = await response.text();
    if (!response.ok) {
      throw new MyHrClientError(
        `MyHR authentication failed: ${response.status} ${sanitizeExternalText(responseBody)}`,
        'RETRYABLE',
        response.status,
      );
    }

    const body = this.parseJson(responseBody);
    const accessToken = this.readString(body, 'accessToken');
    if (!accessToken) {
      throw new MyHrClientError(
        'MyHR authentication returned no token',
        'RETRYABLE',
      );
    }
    return accessToken;
  }

  private normalizeBatchStatus(raw: unknown): MyHrBatchStatus {
    const field = this.config.get<string>('MYHR_STATUS_FIELD', 'status');
    const value = this.readPath(raw, field);
    if (typeof value !== 'string' && typeof value !== 'number') {
      return 'UNKNOWN';
    }

    const normalized = String(value).trim().toLowerCase();
    if (
      getCsvValues(this.config, 'MYHR_STATUS_PENDING_VALUES').includes(
        normalized,
      )
    ) {
      return 'PENDING';
    }
    if (
      getCsvValues(this.config, 'MYHR_STATUS_SUCCESS_VALUES').includes(
        normalized,
      )
    ) {
      return 'SUCCESS';
    }
    if (
      getCsvValues(this.config, 'MYHR_STATUS_FAILED_VALUES').includes(
        normalized,
      )
    ) {
      return 'FAILED';
    }
    return 'UNKNOWN';
  }

  private readPath(value: unknown, path: string): unknown {
    return path.split('.').reduce<unknown>((current, key) => {
      if (!current || typeof current !== 'object') return undefined;
      return (current as Record<string, unknown>)[key];
    }, value);
  }

  private readString(value: unknown, key: string): string | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const result = (value as Record<string, unknown>)[key];
    return typeof result === 'string' && result.length > 0 ? result : undefined;
  }

  private parseJson(value: string): unknown {
    if (!value) return {};
    try {
      return JSON.parse(value) as unknown;
    } catch {
      throw new MyHrClientError(
        `MyHR returned invalid JSON: ${sanitizeExternalText(value)}`,
        'AMBIGUOUS',
      );
    }
  }

  private fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    return fetch(url, {
      ...init,
      signal: AbortSignal.timeout(
        getPositiveInteger(this.config, 'MYHR_HTTP_TIMEOUT_MS', 60_000),
      ),
    });
  }

  private apiUrl(): string {
    return this.config.getOrThrow<string>('MYHR_API_URL').replace(/\/$/, '');
  }
}
