type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function getConfiguredLevel(): LogLevel {
  const raw = process.env.LOG_LEVEL ?? "info";
  if (raw in LEVELS) return raw as LogLevel;
  return "info";
}

function fmt(level: LogLevel, namespace: string, message: string, meta?: unknown): string {
  const ts = new Date().toISOString();
  const base = `[${ts}] [${level.toUpperCase()}] [${namespace}] ${message}`;
  return meta !== undefined ? `${base} ${JSON.stringify(meta)}` : base;
}

export function createLogger(namespace: string) {
  const minLevel = LEVELS[getConfiguredLevel()];

  return {
    debug: (message: string, meta?: unknown) => {
      if (minLevel <= LEVELS.debug) console.debug(fmt("debug", namespace, message, meta));
    },
    info: (message: string, meta?: unknown) => {
      if (minLevel <= LEVELS.info) console.info(fmt("info", namespace, message, meta));
    },
    warn: (message: string, meta?: unknown) => {
      if (minLevel <= LEVELS.warn) console.warn(fmt("warn", namespace, message, meta));
    },
    error: (message: string, meta?: unknown) => {
      if (minLevel <= LEVELS.error) console.error(fmt("error", namespace, message, meta));
    },
  };
}

export type Logger = ReturnType<typeof createLogger>;
