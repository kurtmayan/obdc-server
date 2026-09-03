import type { Prisma } from 'src/generated/prisma/client';
import { MyHrRecordSyncStatus } from 'src/generated/prisma/enums';

export const MY_HR_SYNC_ELIGIBLE_ATTENDANCE_WHERE = {
  OR: [
    {
      myHrSyncRecord: {
        is: null,
      },
    },
    {
      myHrSyncRecord: {
        is: {
          status: MyHrRecordSyncStatus.FAILED,
        },
      },
    },
  ],
} satisfies Prisma.AttendanceRecordWhereInput;
