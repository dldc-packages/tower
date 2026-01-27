/**
 * Custom error types for Tower
 */

/**
 * Base error class for Tower errors
 */
export class TowerError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TowerError";
  }
}

/**
 * Configuration validation error
 */
export class ValidationError extends TowerError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ValidationError";
  }
}

/**
 * Docker/Compose execution error
 */
export class DockerError extends TowerError {
  constructor(message: string, options?: ErrorOptions & { exitCode?: number }) {
    super(message, options);
    this.name = "DockerError";
    if (options?.exitCode !== undefined) {
      this.exitCode = options.exitCode;
    }
  }
  exitCode?: number;
}

/**
 * Registry API error
 */
export class RegistryError extends TowerError {
  constructor(message: string, options?: ErrorOptions & { statusCode?: number }) {
    super(message, options);
    this.name = "RegistryError";
    if (options?.statusCode !== undefined) {
      this.statusCode = options.statusCode;
    }
  }
  statusCode?: number;
}

/**
 * DNS validation error
 */
export class DnsError extends TowerError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DnsError";
  }
}

/**
 * Health check timeout error
 */
export class HealthCheckError extends TowerError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "HealthCheckError";
  }
}

/**
 * Authentication error
 */
export class AuthError extends TowerError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AuthError";
  }
}
