import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsPositive, IsString } from 'class-validator';

export class StoreLookup {
  @ApiPropertyOptional({ description: 'Search by name or location' })
  @IsOptional()
  @IsString()
  q?: string;
}

export class FindAllStoreDto extends StoreLookup {
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
