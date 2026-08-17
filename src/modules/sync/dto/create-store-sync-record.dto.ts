import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsString,
  ValidateNested,
} from 'class-validator';

export class AttendanceDto {
  @IsString()
  employee_name: string;

  @IsString()
  employee_id: string;

  @IsString()
  log_date: string;

  @IsInt()
  punch: number;

  @IsString()
  id: string;
}

export class SyncRecordDto {
  @IsString()
  device_id: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttendanceDto)
  attendance_record: AttendanceDto[];
}

export class CreateStoreSyncRecord {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SyncRecordDto)
  sync_record: SyncRecordDto[];
}