import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
} from 'class-validator';
import { Cluster, Division, SyncStatus } from 'src/generated/prisma/enums';

export class FindGeneralRecordDto {
  @ApiPropertyOptional({ description: 'Search by store name, location, or code' })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ enum: Division })
  @IsOptional()
  @IsEnum(Division)
  division?: Division;

  @ApiPropertyOptional({ enum: Cluster })
  @IsOptional()
  @IsEnum(Cluster)
  cluster?: Cluster;

  @ApiPropertyOptional({ enum: SyncStatus })
  @IsOptional()
  @IsEnum(SyncStatus)
  status?: SyncStatus;

  @ApiPropertyOptional({ description: 'Latest sync start date' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'Latest sync end date' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ default: 1, description: 'Page number' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  page: number = 1;

  @ApiPropertyOptional({ default: 10, description: 'Items per page' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  pageSize: number = 10;
}