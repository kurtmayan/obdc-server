import type { Prisma } from 'src/generated/prisma/client';

type ConfigReader = {
  get<T = unknown>(key: string): T | undefined;
};

export function getMyHrSyncEligibleAttendanceWhere(
  configReader: ConfigReader,
): Prisma.AttendanceRecordWhereInput {
  const unsyncedAttendanceWhere = {
    myHrSyncRecord: {
      is: null,
    },
    logDate: {
      gte: new Date('2026-10-06T00:00:00.000Z'),
    },
  } satisfies Prisma.AttendanceRecordWhereInput;
  const pilotTestingValue = configReader.get<string>('IS_PILOT_TESTING');
  const isPilotTesting =
    typeof pilotTestingValue === 'string' &&
    pilotTestingValue.trim().toLowerCase() === 'true';

  if (!isPilotTesting) {
    return unsyncedAttendanceWhere;
  }

  return {
    AND: [
      unsyncedAttendanceWhere,
      {
        storeSyncRecords: {
          store: {
            name: {
              in: ['HOEW', 'HOEL'],
            },
          },
        },
      },
    ],
  } satisfies Prisma.AttendanceRecordWhereInput;
}
