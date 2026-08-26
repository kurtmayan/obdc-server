import { Type } from "class-transformer";
import { IsArray, IsInt, IsString, ValidateNested } from "class-validator";

class BiometricDto {
    @IsString()
    "empid": string;

    @IsString()
    "logdt": string;

    @IsString()
    "logtm": string;

    @IsInt()
    "logstats": number;

    @IsString()
    "location": string;
}

export class MyHrRecordDto {
  @IsString()
  device_id: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BiometricDto)
  biometric_record: BiometricDto[];
}

export class CreateMyHrRecord {
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => MyHrRecordDto)
    sync_record: MyHrRecordDto[];
}
