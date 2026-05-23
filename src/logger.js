// Tiny structured logger. Routes to console with level prefix and timestamp.
// Centralizing this means future work (sending logs to a panel, downloading
// a debug dump, silencing in production) lives in one place.

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
let currentLevel = LEVELS.info;

export function setLogLevel(name) {
  if (LEVELS[name] != null) currentLevel = LEVELS[name];
}

function ts() {
  const d = new Date();
  return d.toISOString().split('T')[1].replace('Z', '');
}

function emit(level, args) {
  if (LEVELS[level] < currentLevel) return;
  const tag = `[${ts()}] [${level.toUpperCase()}]`;
  const fn = console[level] || console.log;
  fn(tag, ...args);
}

export const log = {
  debug: (...a) => emit('debug', a),
  info:  (...a) => emit('info', a),
  warn:  (...a) => emit('warn', a),
  error: (...a) => emit('error', a)
};
