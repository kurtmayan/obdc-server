export type Attendance = {
  employee_name: string;
  employee_id: string;
  log_date: string;
  punch: number;
};

export class CreateStoreSyncRecord {
  'device-id': string;
  attendance: Attendance[];
}
