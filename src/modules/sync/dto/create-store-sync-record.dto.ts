import {} from 'class-validator';

export type LogType = {
  0: 'timeIn';
  1: 'timeOut';
};

export type Attendance = {
  name: string;
  user_id: string;
  logDate: string;
  logType: LogType;
};

export class CreateStoreSyncRecord {
  device_id: string;
  attendance: Attendance[];
}
