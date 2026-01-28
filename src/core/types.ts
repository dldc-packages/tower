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

export interface ResolvedService extends App {
  /** Service kind */
  kind: "infra" | "app";

  /** Resolved immutable image reference (with digest when available) */
  imageDigest: string;

  /** Upstream container DNS name for reverse proxy (defaults to name) */
  upstreamName?: string;

  /** Upstream container port for reverse proxy (defaults to port) */
  upstreamPort?: number;
}
