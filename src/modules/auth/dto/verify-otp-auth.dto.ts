import { IsEmail, IsString, Length } from 'class-validator';

export class VerifyOtpAuthDto {
  @IsEmail()
  email: string;

  @IsString()
  @Length(6, 6)
  otp: string;
}
