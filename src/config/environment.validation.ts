const POSITIVE_INTEGER_SETTINGS: Record<string, number> = {
  AWS_SQS_VISIBILITY_TIMEOUT_SECONDS: 300,
  MYHR_JOB_RECORD_LIMIT: 5000,
  MYHR_CHUNK_SIZE: 500,
  MYHR_WORKER_CONCURRENCY: 2,
  MYHR_HTTP_TIMEOUT_MS: 60000,
  MYHR_UPLOAD_LEASE_SECONDS: 120,
  MYHR_MAX_UPLOAD_ATTEMPTS: 3,
  MYHR_VERIFICATION_DEADLINE_HOURS: 24,
  MYHR_RETENTION_DAYS: 30,
  MYHR_ACTIVE_JOB_WARN_MINUTES: 120,
  MYHR_OUTBOX_WARN_MINUTES: 5,
  MYHR_OUTBOX_TRANSACTION_TIMEOUT_MS: 60000,
  MYHR_JOB_TRANSACTION_TIMEOUT_MS: 120000,
};

export function validateEnvironment(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const config = { ...input };
  const enabled = asEnvironmentString(
    config.MYHR_SYNC_ENABLED,
    'false',
  ).toLowerCase();
  if (enabled !== 'true' && enabled !== 'false') {
    throw new Error('MYHR_SYNC_ENABLED must be true or false');
  }
  config.MYHR_SYNC_ENABLED = enabled;

  const workerEnabled = asEnvironmentString(
    config.MYHR_WORKER_ENABLED,
    'false',
  ).toLowerCase();
  if (workerEnabled !== 'true' && workerEnabled !== 'false') {
    throw new Error('MYHR_WORKER_ENABLED must be true or false');
  }
  config.MYHR_WORKER_ENABLED = workerEnabled;

  if (enabled === 'true' || workerEnabled === 'true') {
    for (const key of [
      'AWS_REGION',
      'AWS_SQS_QUEUE_URL',
      'MYHR_API_URL',
      'MYHR_USERNAME',
      'MYHR_PASSWORD',
      'MYHR_STATUS_FIELD',
      'MYHR_STATUS_PENDING_VALUES',
      'MYHR_STATUS_SUCCESS_VALUES',
      'MYHR_STATUS_FAILED_VALUES',
    ]) {
      if (!asEnvironmentString(config[key], '').trim()) {
        throw new Error(
          `${key} is required when MyHR synchronization is enabled`,
        );
      }
    }
    validateUrl(config.AWS_SQS_QUEUE_URL, 'AWS_SQS_QUEUE_URL');
    validateUrl(config.MYHR_API_URL, 'MYHR_API_URL');
  }

  for (const [key, fallback] of Object.entries(POSITIVE_INTEGER_SETTINGS)) {
    const raw = config[key] ?? fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`${key} must be a positive integer`);
    }
    config[key] = String(value);
  }

  if (Number(config.MYHR_CHUNK_SIZE) > Number(config.MYHR_JOB_RECORD_LIMIT)) {
    throw new Error('MYHR_CHUNK_SIZE cannot exceed MYHR_JOB_RECORD_LIMIT');
  }
  if (
    Number(config.MYHR_UPLOAD_LEASE_SECONDS) * 1_000 <=
    Number(config.MYHR_HTTP_TIMEOUT_MS)
  ) {
    throw new Error(
      'MYHR_UPLOAD_LEASE_SECONDS must exceed the MyHR HTTP timeout',
    );
  }

  return config;
}

function asEnvironmentString(value: unknown, fallback: string): string {
  if (value === undefined || value === null) return fallback;
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }
  throw new Error('Environment values must be strings, numbers, or booleans');
}

function validateUrl(value: unknown, key: string): void {
  try {
    const url = new URL(asEnvironmentString(value, ''));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error();
    }
  } catch {
    throw new Error(`${key} must be an HTTP(S) URL`);
  }
}
