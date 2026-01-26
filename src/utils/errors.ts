/**
 * Custom error types for Tower
 */

/**
 * Base error class for Tower errors
 */
export class TowerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TowerError";
  }
}

/**
 * Configuration validation error
 */
export class ValidationError extends TowerError {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/**
 * Docker/Compose execution error
 */
export class DockerError extends TowerError {
  constructor(message: string, public readonly exitCode?: number) {
    super(message);
    this.name = "DockerError";
  }
}

/**
 * Registry API error
 */
export class RegistryError extends TowerError {
  constructor(message: string, public readonly statusCode?: number) {
    super(message);
    this.name = "RegistryError";
  }
}

/**
 * DNS validation error
 */
export class DnsError extends TowerError {
  constructor(message: string) {
    super(message);
    this.name = "DnsError";
  }
}

/**
 * Health check timeout error
 */
export class HealthCheckError extends TowerError {
  constructor(message: string) {
    super(message);
    this.name = "HealthCheckError";
  }
}

/**
 * Authentication error
 */
export class AuthError extends TowerError {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}
