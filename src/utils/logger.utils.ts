interface Logger {
  info: (message: string, data?: Record<string, unknown>) => void;
  warn: (message: string, data?: Record<string, unknown>) => void;
  error: (message: string, data?: Record<string, unknown>) => void;
  debug: (message: string, data?: Record<string, unknown>) => void;
}

export const createLogger = (context: string): Logger => {
  const format = (level: string, message: string, data?: Record<string, unknown>): string => {
    const timestamp = new Date().toISOString();
    const base = `[${timestamp}] [${level}] [${context}] ${message}`;
    return data ? `${base} ${JSON.stringify(data)}` : base;
  };

  return {
    info: (message, data) => console.log(format('INFO', message, data)),
    warn: (message, data) => console.warn(format('WARN', message, data)),
    error: (message, data) => console.error(format('ERROR', message, data)),
    debug: (message, data) => console.debug(format('DEBUG', message, data)),
  };
};
