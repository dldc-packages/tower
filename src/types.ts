/**
 * Tower type definitions
 *
 * Defines the Intent schema and related types for deployment configuration.
 */

/**
 * Main intent configuration for Tower deployments.
 * This is the single source of truth for infrastructure and application state.
 */
export interface Intent {
  /** Schema version (always "1" for now) */
  version: "1";

  /** Admin email for Let's Encrypt ACME notifications */
  adminEmail: string;

  /** Data directory (optional, defaults to /var/infra if not specified) */
  dataDir?: string;

  /** Tower service configuration */
  tower: {
    /** Tower version (semver or digest) */
    version: string;
    /** Tower domain (e.g., "tower.example.com") */
    domain: string;
    /** Tower API username */
    username: string;
    /** Tower API password hash (bcrypt) */
    passwordHash: string;
  };

  /** Docker Registry configuration */
  registry: {
    /** Registry domain (e.g., "registry.example.com") */
    domain: string;
    /** Registry username */
    username: string;
    /** Registry password hash (bcrypt) */
    passwordHash: string;
  };

  /** OTEL-LGTM observability stack configuration */
  otel: {
    /** OTEL-LGTM image version */
    version: string;
    /** OTEL-LGTM domain (e.g., "otel.example.com") */
    domain: string;
  };

  /** Application services to deploy */
  apps: App[];
}

/** Discriminated union for volume types */
export type Volume =
  | { type: "bind"; source: string; target: string; readonly?: boolean }
  | { type: "named"; name: string; target: string; readonly?: boolean };

/** Port binding configuration */
export interface Port {
  host: number;
  container: number;
  protocol?: "tcp" | "udp";
}

/**
 * Application service configuration
 */
export interface App {
  /** Unique application identifier (used as container/service name) */
  name: string;

  /**
   * Container image reference with optional semver range
   * Examples:
   * - "registry.example.com/api:^1.2.0" (semver range)
   * - "registry.example.com/api:1.2.3" (exact version)
   * - "registry.example.com/api@sha256:abc..." (digest)
   */
  image: string;

  /** Primary domain for the application */
  domain: string;

  /** Port the application listens on (default: 3000) */
  port?: number;

  /** Environment variables (non-sensitive) */
  env?: Record<string, string>;

  /** Secret environment variables (will be redacted in logs) */
  secrets?: Record<string, string>;

  /** Health check configuration */
  healthCheck?: HealthCheck;

  /** Container restart policy */
  restart?: string;

  /** Docker volumes to mount (bind or named) */
  volumes?: Volume[];

  /** Port bindings (host:container) */
  ports?: Port[];

  /** Container startup command */
  command?: string[];

  /**
   * Authentication configuration
   * undefined = no auth required
   * {kind: 'basic', ...} = basic auth required for all requests
   */
  auth?: { kind: "basic"; username: string; passwordHash: string };
}

/**
 * Container health check configuration
 */
export interface HealthCheck {
  /** HTTP path for health check (e.g., "/health") */
  path?: string;

  /** Port for health check (defaults to app.port) */
  port?: number;

  /** Health check interval in seconds (default: 10) */
  interval?: number;

  /** Health check timeout in seconds (default: 5) */
  timeout?: number;

  /** Number of retries before marking unhealthy (default: 3) */
  retries?: number;
}
