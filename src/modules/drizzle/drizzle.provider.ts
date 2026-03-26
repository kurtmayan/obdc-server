import { ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/node-postgres';

export const DrizzleProvider = {
  provide: 'DRIZZLE_DB',
  useFactory: async (configService: ConfigService) => {
    const connectionString = configService.get<string>('DATABASE_URL');
    if (!connectionString) {
      throw new Error('DATABASE_URL is not defined');
    }
    const db = drizzle({
      connection: {
        connectionString,
        ssl: true,
      },
    });
    return db;
  },
  inject: [ConfigService],
};
