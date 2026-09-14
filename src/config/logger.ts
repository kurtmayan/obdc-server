import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';

const LOG_DIRECTORY = 'logs';

const ensureLogDirectory = (filename: string): void => {
  mkdirSync(dirname(filename), { recursive: true });
};

const myHrOnly = winston.format((info) =>
  info.myHrLog === true ? info : false,
);

const excludeMyHr = winston.format((info) =>
  info.myHrLog === true ? false : info,
);

export function createAppLogger() {
  const applicationLog = `${LOG_DIRECTORY}/application.log`;
  const errorLog = `${LOG_DIRECTORY}/error.log`;
  const myHrLog = `${LOG_DIRECTORY}/myhr.log`;

  [applicationLog, errorLog, myHrLog].forEach(ensureLogDirectory);

  const jsonFormat = winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json(),
  );

  return WinstonModule.createLogger({
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.printf(
            ({ timestamp, level, message, context }) =>
              `${timestamp} [${level.toUpperCase()}]${
                context ? ` [${context}]` : ''
              } ${message}`,
          ),
        ),
      }),
      new winston.transports.File({
        filename: applicationLog,
        level: 'info',
        format: winston.format.combine(excludeMyHr(), jsonFormat),
      }),
      new winston.transports.File({
        filename: errorLog,
        level: 'error',
        format: jsonFormat,
      }),
      new winston.transports.File({
        filename: myHrLog,
        level: 'info',
        format: winston.format.combine(myHrOnly(), jsonFormat),
      }),
    ],
  });
}
