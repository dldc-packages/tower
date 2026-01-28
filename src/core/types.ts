/**
 * Shared core types
 */

import type { App } from "@dldc/tower/types";

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

export interface ResolvedService extends App {
  /** Service kind */
  kind: "infra" | "app";

  /** Original image reference from intent (may contain semver range, tag, or digest) */
  imageRef: string;

  /** Resolved immutable image reference (with digest when available) */
  imageDigest: string;

  /** Upstream container DNS name for reverse proxy (defaults to name) */
  upstreamName?: string;

  /** Upstream container port for reverse proxy (defaults to port) */
  upstreamPort?: number;
}
