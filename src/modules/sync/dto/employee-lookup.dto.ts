import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class EmployeeLookupDto {
  @ApiPropertyOptional({ description: 'Search by employee ID' })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ description: 'Comma-separated store IDs' })
  @IsOptional()
  @IsString()
  storeIds?: string;
}
