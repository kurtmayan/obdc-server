import {} from 'class-validator';

export type LogType = {
  0: 'timein';
  1: 'timeout';
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
