const isDebug = process.env.DEBUG === 'true';

type LogCallback = (message: string) => void;

let sseCallback: LogCallback | null = null;

export function setSseCallback(cb: LogCallback): void {
  sseCallback = cb;
}

function ts(): string {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

function log(prefix: string, message: string): void {
  const line = `[${ts()}] ${prefix} ${message}`;
  console.log(line);
  if (sseCallback) sseCallback(line);
}

function err(prefix: string, message: string, error?: unknown): void {
  const line = `[${ts()}] ${prefix} ${message}`;
  console.error(line);
  if (sseCallback) sseCallback(line);
  if (error && isDebug) {
    console.error(error);
  }
}

export const logger = {
  info: (message: string): void => log('ℹ️ ', message),
  success: (message: string): void => log('✅', message),
  warn: (message: string): void => log('⚠️ ', message),
  step: (message: string): void => log('🔄', message),
  result: (message: string): void => log('📊', message),
  separator: (): void => log('', '-'.repeat(60)),
  error: (message: string, error?: unknown): void => err('❌', message, error),
};