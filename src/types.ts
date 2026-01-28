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
    /** OTEL username */
    username: string;
    /** OTEL password hash (bcrypt) */
    passwordHash: string;
  };

  /** Application services to deploy */
  apps: App[];
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
  volumes?: Array<{
    type: "bind" | "named";
    source?: string;
    name?: string;
    target: string;
    readonly?: boolean;
  }>;

  /** Port bindings (host:container) */
  ports?: Array<{
    host: number;
    container: number;
    protocol?: "tcp" | "udp";
  }>;

  /** Container startup command */
  command?: string[];

  /**
   * Authentication configuration
   * Controls access restrictions and credential validation
   */
  auth?: {
    /** Authentication policy */
    policy: "none" | "basic_all" | "basic_write_only" | "basic_scoped";
    /** Basic auth user credentials (username and bcrypt password hashes) */
    basicUsers?: Array<{
      username: string;
      passwordHash: string;
    }>;
    /** Optional path/method restrictions for scoped auth */
    scopes?: Array<{
      path?: string[];
      method?: string[];
    }>;
  };
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

/**
 * Applied intent - stores resolved state after deployment
 */
export interface AppliedIntent extends Intent {
  /** Timestamp when this intent was applied */
  appliedAt: string;

  /** Resolved image digests for all apps */
  resolvedImages: Record<string, string>;
}

/**
 * Deployment status response
 */
export interface DeploymentStatus {
  /** Current applied intent (if any) */
  appliedIntent?: AppliedIntent;

  /** Running services and their health */
  services: ServiceStatus[];

  /** Active domains and their routes */
  domains: DomainStatus[];
}

/**
 * Individual service status
 */
export interface ServiceStatus {
  name: string;
  state: "running" | "starting" | "unhealthy" | "stopped";
  health?: "healthy" | "unhealthy" | "starting";
  image?: string;
}

/**
 * Domain routing status
 */
export interface DomainStatus {
  domain: string;
  target: string;
  tlsEnabled: boolean;
}
