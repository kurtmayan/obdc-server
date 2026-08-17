import { IsEmail, IsString } from 'class-validator';

export class ResendOtpAuthDto {
  @IsEmail()
  @IsString()
  email: string;
}
