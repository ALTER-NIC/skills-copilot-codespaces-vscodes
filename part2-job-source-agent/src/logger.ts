import type { Logger } from './types.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

const COLOR: Record<Level, string> = {
  debug: '\x1b[90m', info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m',
};

/** Minimal leveled logger. Writes to stderr so stdout stays clean for JSON output. */
export function createLogger(level: Level = 'info', enabled = true): Logger {
  const min = LEVELS[level];
  const emit = (l: Level, msg: string, meta?: unknown) => {
    if (!enabled || LEVELS[l] < min) return;
    const tail = meta === undefined ? '' : ' ' + safeJson(meta);
    process.stderr.write(`${COLOR[l]}${l.padEnd(5)}\x1b[0m ${msg}${tail}\n`);
  };
  return {
    debug: (m, x) => emit('debug', m, x),
    info: (m, x) => emit('info', m, x),
    warn: (m, x) => emit('warn', m, x),
    error: (m, x) => emit('error', m, x),
  };
}

function safeJson(v: unknown): string {
  try {
    const s = JSON.stringify(v);
    return s.length > 400 ? s.slice(0, 400) + '…' : s;
  } catch {
    return String(v);
  }
}

export const silentLogger: Logger = {
  debug() {}, info() {}, warn() {}, error() {},
};
