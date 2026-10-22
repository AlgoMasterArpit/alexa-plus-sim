import { pino, type Logger } from 'pino';

export type { Logger };

export function createLogger(level: string): Logger {
  return pino({
    level,
    base: { service: 'alexa-plus-sim' },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: ['token', '*.token', 'headers.authorization'], censor: '[redacted]' },
  });
}
