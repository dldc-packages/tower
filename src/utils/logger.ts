/**
 * Logger utility with secret redaction and pluggable sinks
 *
 * Default: console only, text format. Extra sinks can be added per use (e.g., stream + console).
 */

type LogLevel = "debug" | "info" | "warn" | "error";
type LogFormat = "text" | "json";

type LogSink = (entry: LogEntry) => void;

interface LoggerOptions {
  level?: LogLevel;
  format?: LogFormat;
  sinks?: LogSink[];
}

interface LogEntry {
  level: LogLevel;
  format: LogFormat;
  args: unknown[];
  message: string;
  timestamp: Date;
  payload: {
    level: LogLevel;
    time: string;
    message: string;
    args: unknown[];
  };
}

class Logger {
  private minLevel: LogLevel;
  private sinks: LogSink[];
  private format: LogFormat;

  constructor(options: LoggerOptions = {}) {
    this.minLevel = options.level ?? "info";
    this.format = options.format ?? "text";
    this.sinks = options.sinks ?? [createConsoleSink()];
  }

  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  getLevel(): LogLevel {
    return this.minLevel;
  }

  debug(...args: unknown[]): void {
    this.log("debug", args);
  }

  info(...args: unknown[]): void {
    this.log("info", args);
  }

  warn(...args: unknown[]): void {
    this.log("warn", args);
  }

  error(...args: unknown[]): void {
    this.log("error", args);
  }

  private log(level: LogLevel, args: unknown[]): void {
    if (!this.shouldLog(level)) return;

    const redactedArgs = this.redact(args);
    const message = this.buildMessage(redactedArgs);
    const timestamp = new Date();

    const entry: LogEntry = {
      level,
      format: this.format,
      args: redactedArgs,
      message,
      timestamp,
      payload: {
        level,
        time: timestamp.toISOString(),
        message,
        args: redactedArgs,
      },
    };

    for (const sink of this.sinks) {
      sink(entry);
    }
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ["debug", "info", "warn", "error"];
    return levels.indexOf(level) >= levels.indexOf(this.minLevel);
  }

  private buildMessage(args: unknown[]): string {
    return args
      .map((arg) => {
        if (typeof arg === "string") return arg;
        if (typeof arg === "number" || typeof arg === "boolean") return String(arg);
        if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      })
      .join(" ");
  }

  private redact(args: unknown[]): unknown[] {
    return args.map((arg) => {
      if (typeof arg === "string") {
        return this.redactString(arg);
      } else if (typeof arg === "object" && arg !== null) {
        return this.redactObject(arg);
      }
      return arg;
    });
  }

  private redactString(str: string): string {
    const sensitivePattern = /(password|secret|token|key|auth)=[^\s&]*/gi;
    return str.replace(sensitivePattern, "$1=***REDACTED***");
  }

  private redactObject(obj: unknown): unknown {
    if (Array.isArray(obj)) {
      return obj.map((item) => this.redactObject(item));
    }

    if (typeof obj === "object" && obj !== null) {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        if (this.isSensitiveKey(key)) {
          result[key] = "***REDACTED***";
        } else if (typeof value === "object") {
          result[key] = this.redactObject(value);
        } else {
          result[key] = value;
        }
      }
      return result;
    }

    return obj;
  }

  private isSensitiveKey(key: string): boolean {
    const lowerKey = key.toLowerCase();
    const sensitiveWords = [
      "password",
      "secret",
      "token",
      "key",
      "auth",
      "credential",
      "apikey",
      "api_key",
    ];
    return sensitiveWords.some((word) => lowerKey.includes(word));
  }
}

export function createConsoleSink(): LogSink {
  return (entry) => {
    const method = entry.level === "debug"
      ? "debug"
      : entry.level === "info"
      ? "log"
      : entry.level === "warn"
      ? "warn"
      : "error";

    if (entry.format === "json") {
      console[method](JSON.stringify(entry.payload));
    } else {
      console[method](entry.message);
    }
  };
}

export function createStreamSink(
  write: (line: string) => void,
  format: LogFormat = "text",
): LogSink {
  return (entry) => {
    const line = format === "json" ? JSON.stringify(entry.payload) : entry.message;
    write(line);
  };
}

export function createLogger(options: LoggerOptions = {}): Logger {
  return new Logger(options);
}

export type { LogFormat, LoggerOptions, LogLevel, LogSink };

export const logger = createLogger();
