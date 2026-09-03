import { ConfigService } from '@nestjs/config';

export function getPositiveInteger(
  config: ConfigService,
  key: string,
  fallback: number,
): number {
  const value = Number(config.get<string>(key));
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export function getCsvValues(config: ConfigService, key: string): string[] {
  return (config.get<string>(key) ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export function sanitizeExternalText(value: string, limit = 500): string {
  return value
    .replace(/[\r\n\t]+/g, ' ')
    .replace(
      /("?(?:password|token|accessToken|refreshToken|authorization)"?\s*[:=]\s*")([^"]+)(")/gi,
      '$1[REDACTED]$3',
    )
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(
      /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
      '[REDACTED_JWT]',
    )
    .slice(0, limit);
}
