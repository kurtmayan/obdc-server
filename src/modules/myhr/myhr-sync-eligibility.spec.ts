import { describe, expect, it } from '@jest/globals';
import { getMyHrSyncEligibleAttendanceWhere } from './myhr-sync-eligibility';

describe('MyHR sync eligibility', () => {
  it.each([
    undefined,
    'false',
    'not-true',
    true,
  ])('uses normal unsynced eligibility when IS_PILOT_TESTING=%p', (value) => {
    expect(
      getMyHrSyncEligibleAttendanceWhere({
        get: () => value,
      }),
    ).toEqual({
      myHrSyncRecord: {
        is: null,
      },
    });
  });

  it('limits eligibility by store name and log date when pilot testing is enabled', () => {
    expect(
      getMyHrSyncEligibleAttendanceWhere({
        get: () => 'TRUE',
      }),
    ).toEqual({
      AND: [
        {
          myHrSyncRecord: {
            is: null,
          },
        },
        {
          logDate: {
            gte: new Date('2026-09-22T00:00:00.000Z'),
          },
          storeSyncRecords: {
            store: {
              name: {
                in: ['HOEW', 'HOEL'],
              },
            },
          },
        },
      ],
    });
  });
});
