export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEvent {
  level: LogLevel;
  scope: string;
  message: string;
  timestamp: string;
  details?: unknown;
}

const events: LogEvent[] = [];

export function log(level: LogLevel, scope: string, message: string, details?: unknown) {
  const event: LogEvent = { level, scope, message, timestamp: new Date().toISOString(), details };
  events.push(event);
  if (events.length > 200) events.shift();
  console[level](`[${scope}] ${message}`, details ?? '');
}

export function getRecentLogs(): readonly LogEvent[] {
  return events;
}
