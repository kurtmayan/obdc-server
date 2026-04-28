export type Attendance = {
  employee_name: string;
  employee_id: string;
  log_date: string;
  punch: number;
  id: string;
};

export class CreateStoreSyncRecord {
  'device-id': string;
  attendance: Attendance[];
}
