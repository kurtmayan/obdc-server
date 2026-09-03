import { ConfigService } from '@nestjs/config';
import { MyHrClient, MyHrClientError } from './myhr.client';

describe('MyHrClient', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('normalizes configured batch statuses', async () => {
    const client = new MyHrClient(
      createConfig({
        MYHR_STATUS_PENDING_VALUES: 'pending,processing',
        MYHR_STATUS_SUCCESS_VALUES: 'complete',
        MYHR_STATUS_FAILED_VALUES: 'failed',
      }),
    );
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ accessToken: 'token' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'complete' }));

    await expect(client.getBatchStatus('batch-1')).resolves.toMatchObject({
      status: 'SUCCESS',
    });
  });

  it('fails closed for an unrecognized status response', async () => {
    const client = new MyHrClient(createConfig({}));
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ accessToken: 'token' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'vendor-new-value' }));

    await expect(client.getBatchStatus('batch-1')).resolves.toMatchObject({
      status: 'UNKNOWN',
    });
  });

  it('classifies a success response without batchId as ambiguous', async () => {
    const client = new MyHrClient(createConfig({}));
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ accessToken: 'token' }))
      .mockResolvedValueOnce(jsonResponse({ accepted: true }));

    await expect(
      client.upload([
        {
          empid: 'employee-1',
          logdt: '09/02/2026',
          logtm: '09/02/2026 09:00',
          logstats: 1,
          location: 'Store 1',
        },
      ]),
    ).rejects.toMatchObject<MyHrClientError>({ kind: 'AMBIGUOUS' });
  });
});

function createConfig(values: Record<string, string>): ConfigService {
  const defaults: Record<string, string> = {
    MYHR_API_URL: 'https://myhr.example.test',
    MYHR_USERNAME: 'user',
    MYHR_PASSWORD: 'password',
    MYHR_HTTP_TIMEOUT_MS: '60000',
    MYHR_STATUS_FIELD: 'status',
  };
  const settings = { ...defaults, ...values };
  return {
    get: jest.fn((key: string, fallback?: string) => settings[key] ?? fallback),
    getOrThrow: jest.fn((key: string) => {
      const value = settings[key];
      if (!value) throw new Error(`Missing ${key}`);
      return value;
    }),
  } as unknown as ConfigService;
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
