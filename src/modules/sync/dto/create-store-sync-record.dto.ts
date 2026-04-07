export type Attendance = {
  name: string;
  user_id: string;
  logDate: string;
  logType: number;
};

export class CreateStoreSyncRecord {
  device_id: string;
  attendance: Attendance[];
}
