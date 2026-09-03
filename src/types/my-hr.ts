/** The exact payload sent to the MyHR bulk-upload API. */
export type MyHrPayload = {
  empid: string;
  logdt: string;
  logtm: string;
  logstats: number;
  location: string;
};

/**
 * Internal payload used while preparing chunks. The source record ID is used
 * to update local delivery state and is removed before calling MyHR.
 */
export type MyHrSyncPayload = MyHrPayload & {
  attendanceRecordId: string;
};
