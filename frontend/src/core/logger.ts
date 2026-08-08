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

export function captureFrontendError(source: string, error: unknown, context?: Record<string, unknown>) {
  const normalized = error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Unknown frontend error');
  log('error', source, normalized.message, { stack: normalized.stack, ...context });
  void reportFrontendCrash({ source, kind: normalized.name || 'FrontendError', message: normalized.message, stack: normalized.stack ?? '', context: context ?? {} })
    .catch((reportError) => console.error('[crash-report] Failed to save frontend crash report', reportError));
}

export function installGlobalErrorCapture() {
  window.addEventListener('error', (event) => {
    captureFrontendError('window', event.error ?? event.message, { filename: event.filename, line: event.lineno, column: event.colno });
  });
  window.addEventListener('unhandledrejection', (event) => {
    captureFrontendError('promise', event.reason, { unhandledRejection: true });
  });
}
import { reportFrontendCrash } from '../api';
