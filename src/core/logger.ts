const isDebug = process.env.DEBUG === 'true';

function timestamp(): string {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

export const logger = {
  info: (message: string): void => {
    console.log(`[${timestamp()}] ℹ️  ${message}`);
  },

  success: (message: string): void => {
    console.log(`[${timestamp()}] ✅ ${message}`);
  },

  warn: (message: string): void => {
    console.warn(`[${timestamp()}] ⚠️  ${message}`);
  },

  error: (message: string, error?: unknown): void => {
    console.error(`[${timestamp()}] ❌ ${message}`);
    if (error && isDebug) {
      console.error(error);
    }
  },

  step: (message: string): void => {
    console.log(`[${timestamp()}] 🔄 ${message}`);
  },

  result: (message: string): void => {
    console.log(`\n[${timestamp()}] 📊 ${message}\n`);
  },

  separator: (): void => {
    console.log('-'.repeat(60));
  },
};