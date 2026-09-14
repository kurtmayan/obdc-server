import { describe, expect, it } from '@jest/globals';
import { createAppLogger } from './logger';

type WinstonBackedLogger = ReturnType<typeof createAppLogger> & {
  getWinstonLogger(): {
    transports: Array<{
      filename?: string;
      format?: unknown;
    }>;
  };
};

describe('createAppLogger', () => {
  it('creates file transports for application, error, and MyHR logs', () => {
    const logger = createAppLogger() as WinstonBackedLogger;
    const filenames = logger
      .getWinstonLogger()
      .transports.map((transport) => transport.filename)
      .filter(Boolean);

    expect(filenames).toEqual(
      expect.arrayContaining([
        'application.log',
        'error.log',
        'myhr.log',
      ]),
    );
  });
});
