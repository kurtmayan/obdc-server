import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsOptional, Matches } from 'class-validator';

export enum ExportStoreSyncStatusFormat {
  XLSX = 'xlsx',
  CSV = 'csv',
}

const DATE_ONLY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export class ExportStoreSyncStatusDto {
  @ApiProperty({
    description: 'First attendance date to include, in YYYY-MM-DD format',
    example: '2026-07-01',
    pattern: DATE_ONLY_PATTERN.source,
  })
  @Matches(DATE_ONLY_PATTERN, {
    message: 'startDate must be in YYYY-MM-DD format',
  })
  @IsDateString(
    { strict: true, strictSeparator: true },
    { message: 'startDate must be a valid date' },
  )
  startDate: string;

  @ApiProperty({
    description: 'Last attendance date to include, in YYYY-MM-DD format',
    example: '2026-07-31',
    pattern: DATE_ONLY_PATTERN.source,
  })
  @Matches(DATE_ONLY_PATTERN, {
    message: 'endDate must be in YYYY-MM-DD format',
  })
  @IsDateString(
    { strict: true, strictSeparator: true },
    { message: 'endDate must be a valid date' },
  )
  endDate: string;

  @ApiPropertyOptional({
    enum: ExportStoreSyncStatusFormat,
    default: ExportStoreSyncStatusFormat.XLSX,
  })
  @IsOptional()
  @IsEnum(ExportStoreSyncStatusFormat)
  format: ExportStoreSyncStatusFormat = ExportStoreSyncStatusFormat.XLSX;
}
