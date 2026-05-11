import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export enum Division {
  rtm_operations = 'rtm_operations',
  head_office = 'head_office',
  warehouse = 'warehouse',
}

export enum Cluster {
  mindanao_1 = 'mindanao_1',
  mindanao_2 = 'mindanao_2',
  visayas_2 = 'visayas_2',
  visayas_1 = 'visayas_1',
  ncr_north_east = 'ncr_north_east',
  ncr_south_calapa = 'ncr_south_calapa',
  south_luzon = 'south_luzon',
  north_central_luzon = 'north_central_luzon',
  head_office = 'head_office',
  warehouse = 'warehouse',
}

export enum Status {
  active = 'active',
  inactive = 'inactive',
}

export class CreateStoreDto {
  @IsOptional()
  @IsString()
  code: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEnum(Division)
  division: Division;

  @IsString()
  @IsNotEmpty()
  location: string;

  @IsEnum(Cluster)
  cluster: Cluster;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  contactPerson?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  contactNumber?: string | undefined;

  @IsEnum(Status)
  status: Status;
}
