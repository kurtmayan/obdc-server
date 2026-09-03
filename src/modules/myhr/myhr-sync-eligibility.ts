import type { Prisma } from 'src/generated/prisma/client';

export const MY_HR_SYNC_ELIGIBLE_ATTENDANCE_WHERE = {
  myHrSyncRecord: {
    is: null,
  },
} satisfies Prisma.AttendanceRecordWhereInput;
