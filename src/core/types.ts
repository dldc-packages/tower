/**
 * Shared core types
 */

import type { HealthCheck } from "@dldc/tower/types";

export interface BasicAuthUser {
  username: string;
  passwordHash: string;
}

export interface AuthScope {
  path?: string[];
  method?: string[];
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

export interface ResolvedService {
  /** Service name */
  name: string;

  /** Primary domain */
  domain: string;

  /** Listening port */
  port: number;

  /** Version (semver, exact version, or digest) */
  version: string;

  /** Docker image reference */
  image: string;

  /** Upstream container DNS name for reverse proxy (defaults to name) */
  upstreamName?: string;

  /** Upstream container port for reverse proxy (defaults to port) */
  upstreamPort?: number;

  /** Authentication policy for Caddy routing */
  authPolicy?: "none" | "basic_all" | "basic_write_only" | "basic_scoped";

  /** Optional scoped auth matches when policy is scoped/write-only */
  authScopes?: AuthScope[];

  /** Basic auth accounts for protected routes */
  authBasicUsers?: BasicAuthUser[];

  /** Non-sensitive environment variables */
  env?: Record<string, string>;

  /** Sensitive environment variables */
  secrets?: Record<string, string>;

  /** Health check configuration */
  healthCheck?: HealthCheck;

  // Docker Compose specific properties
  /** Container restart policy */
  restart?: string;

  /** Docker volumes to mount (bind or named) */
  volumes?: Volume[];

  /** Port bindings (host:container) */
  ports?: Port[];

  /** Container startup command */
  command?: string[];
}
