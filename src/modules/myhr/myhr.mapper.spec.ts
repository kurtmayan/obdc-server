import { LogStats } from 'src/generated/prisma/enums';
import {
  mapAttendanceToMyHr,
  mapMyHrLogStats,
  parseMyHrPayload,
} from './myhr.mapper';
import { sanitizeExternalText } from './myhr-sync.config';

describe('MyHR attendance mapping', () => {
  it.each([
    [0, LogStats.TIME_OUT],
    [1, LogStats.TIME_IN],
  ])('maps punch %s to the authoritative MyHR state', (value, expected) => {
    expect(mapMyHrLogStats(value)).toBe(expected);
  });

  it('rejects unsupported punch values instead of using NO_VALUE', () => {
    expect(() => mapMyHrLogStats(2)).toThrow('Unsupported MyHR log status');
    expect(() =>
      mapAttendanceToMyHr({
        userId: 'employee-1',
        logDate: new Date('2026-09-02T01:02:00.000Z'),
        logType: 2,
        location: 'Store 1',
      }),
    ).toThrow('Unsupported attendance punch value');
  });

  it('formats timestamps explicitly in Asia/Manila', () => {
    expect(
      mapAttendanceToMyHr({
        userId: 'employee-1',
        logDate: new Date('2026-09-02T16:02:00.000Z'),
        logType: 1,
        location: 'Store 1',
      }),
    ).toEqual({
      empid: 'employee-1',
      logdt: '09/03/2026',
      logtm: '09/03/2026 00:02',
      logstats: 1,
      location: 'Store 1',
    });
  });

  it('validates persisted chunk payloads at runtime', () => {
    expect(() => parseMyHrPayload([{ logstats: 9 }])).toThrow(
      'Invalid MyHR payload item',
    );
  });

  it('redacts credentials in sanitized vendor errors', () => {
    expect(
      sanitizeExternalText(
        '{"accessToken":"secret-value","message":"Bearer bearer-secret"}',
      ),
    ).toBe('{"accessToken":"[REDACTED]","message":"Bearer [REDACTED]"}');
  });
});
