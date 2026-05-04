export type Attendance = {
  employee_name: string;
  employee_id: string;
  log_date: string;
  punch: number;
  id: string;
};

export type SyncRecord = {
  device_id: string;
  attendance_record: Attendance[];
};

export class CreateStoreSyncRecord {
  sync_record: SyncRecord[];
}
