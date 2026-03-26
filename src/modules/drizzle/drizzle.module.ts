import { Global, Module } from '@nestjs/common';
import { DrizzleProvider } from './drizzle.provider';
import { ConfigService } from '@nestjs/config';

@Global()
@Module({
  providers: [DrizzleProvider, ConfigService],
  exports: [DrizzleProvider],
})
export class DrizzleModule {}
