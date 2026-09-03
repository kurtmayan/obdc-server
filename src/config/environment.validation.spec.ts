import { validateEnvironment } from './environment.validation';

describe('validateEnvironment', () => {
  it('defaults both MyHR processes to disabled', () => {
    const result = validateEnvironment({});

    expect(result.MYHR_SYNC_ENABLED).toBe('false');
    expect(result.MYHR_WORKER_ENABLED).toBe('false');
    expect(result.MYHR_CHUNK_SIZE).toBe('500');
  });

  it('refuses enablement without a verified status contract', () => {
    expect(() => validateEnvironment({ MYHR_WORKER_ENABLED: 'true' })).toThrow(
      'AWS_REGION is required',
    );
  });

  it('accepts enablement when all status mappings are supplied', () => {
    const result = validateEnvironment({
      MYHR_WORKER_ENABLED: 'true',
      AWS_REGION: 'ap-southeast-1',
      AWS_SQS_QUEUE_URL: 'https://sqs.example.test/myhr',
      MYHR_API_URL: 'https://myhr.example.test',
      MYHR_USERNAME: 'sandbox-user',
      MYHR_PASSWORD: 'sandbox-secret',
      MYHR_STATUS_FIELD: 'result.status',
      MYHR_STATUS_PENDING_VALUES: 'pending,processing',
      MYHR_STATUS_SUCCESS_VALUES: 'success',
      MYHR_STATUS_FAILED_VALUES: 'failed',
    });

    expect(result.MYHR_WORKER_ENABLED).toBe('true');
  });

  it('rejects unsafe chunk and lease configuration', () => {
    expect(() =>
      validateEnvironment({
        MYHR_JOB_RECORD_LIMIT: '10',
        MYHR_CHUNK_SIZE: '11',
      }),
    ).toThrow('MYHR_CHUNK_SIZE');
    expect(() =>
      validateEnvironment({
        MYHR_HTTP_TIMEOUT_MS: '60000',
        MYHR_UPLOAD_LEASE_SECONDS: '60',
      }),
    ).toThrow('MYHR_UPLOAD_LEASE_SECONDS');
  });
});
