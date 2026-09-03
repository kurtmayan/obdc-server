import { formatInTimeZone } from 'date-fns-tz';
import { LogStats } from 'src/generated/prisma/enums';
import { MyHrPayload } from 'src/types/my-hr';

const MYHR_TIMEZONE = 'Asia/Manila';

export function mapAttendanceToMyHr(record: {
  userId: string;
  logDate: Date;
  logType: number;
  location: string;
}): MyHrPayload {
  if (record.logType !== 0 && record.logType !== 1) {
    throw new Error(`Unsupported attendance punch value: ${record.logType}`);
  }

  return {
    empid: record.userId,
    logdt: formatInTimeZone(record.logDate, MYHR_TIMEZONE, 'MM/dd/yyyy'),
    logtm: formatInTimeZone(record.logDate, MYHR_TIMEZONE, 'MM/dd/yyyy HH:mm'),
    logstats: record.logType,
    location: record.location,
  };
}

export function mapMyHrLogStats(value: number): LogStats {
  if (value === 0) return LogStats.TIME_OUT;
  if (value === 1) return LogStats.TIME_IN;
  throw new Error(`Unsupported MyHR log status: ${value}`);
}

export function parseMyHrPayload(value: unknown): MyHrPayload[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('MyHR chunk payload must be a non-empty array');
  }

  return value.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`Invalid MyHR payload item at index ${index}`);
    }
    const record = item as Record<string, unknown>;
    if (
      typeof record.empid !== 'string' ||
      typeof record.logdt !== 'string' ||
      typeof record.logtm !== 'string' ||
      (record.logstats !== 0 && record.logstats !== 1) ||
      typeof record.location !== 'string'
    ) {
      throw new Error(`Invalid MyHR payload item at index ${index}`);
    }

    return {
      empid: record.empid,
      logdt: record.logdt,
      logtm: record.logtm,
      logstats: record.logstats,
      location: record.location,
    };
  });
}
