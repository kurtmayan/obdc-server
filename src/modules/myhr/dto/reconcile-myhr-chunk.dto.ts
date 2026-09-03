import { Equals, IsString, MaxLength, MinLength } from 'class-validator';

export class AttachMyHrBatchDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  batchId: string;
}

export class RetryUnknownMyHrChunkDto {
  @Equals(true)
  acknowledgeDuplicateRisk: true;
}

export class FailUnknownMyHrChunkDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string;
}
