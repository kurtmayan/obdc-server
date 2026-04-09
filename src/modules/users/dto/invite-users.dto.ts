import { IsEmail, IsEnum, IsOptional, IsString } from 'class-validator';
import { Role } from 'src/generated/prisma/enums';

export class InviteUsersDto {
  @IsString()
  firstName: string;

  @IsString()
  lastName: string;

  @IsEnum(Role)
  role: Role;

  @IsString()
  @IsEmail()
  email: string;

  @IsOptional()
  contactNumber?: string;
}
