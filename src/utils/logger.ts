/**
 * Logger utility with secret redaction
 *
 * Ensures secrets are never logged (env vars with "secret", "password", "token", etc.)
 */

type LogLevel = "debug" | "info" | "warn" | "error";

class Logger {
  private minLevel: LogLevel = "info";

  /**
   * Set minimum log level
   */
  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  /**
   * Log debug message
   */
  debug(...args: unknown[]): void {
    if (this.shouldLog("debug")) {
      console.debug(...this.redact(args));
    }
  }

  /**
   * Log info message
   */
  info(...args: unknown[]): void {
    if (this.shouldLog("info")) {
      console.log(...this.redact(args));
    }
  }

  /**
   * Log warning message
   */
  warn(...args: unknown[]): void {
    if (this.shouldLog("warn")) {
      console.warn(...this.redact(args));
    }
  }

  /**
   * Log error message
   */
  error(...args: unknown[]): void {
    if (this.shouldLog("error")) {
      console.error(...this.redact(args));
    }
  }

  /**
   * Check if level should be logged
   */
  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ["debug", "info", "warn", "error"];
    return levels.indexOf(level) >= levels.indexOf(this.minLevel);
  }

  /**
   * Redact sensitive information from log arguments
   */
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

  /**
   * Redact sensitive patterns in strings
   */
  private redactString(str: string): string {
    // Redact patterns like PASSWORD=xxx, TOKEN=xxx, etc.
    const sensitivePattern = /(password|secret|token|key|auth)=[^\s&]*/gi;
    return str.replace(sensitivePattern, "$1=***REDACTED***");
  }

  /**
   * Redact sensitive keys in objects
   */
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

  /**
   * Check if a key name suggests sensitive data
   */
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

export const logger = new Logger();
