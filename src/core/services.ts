/**
 * Shared deployment utilities
 *
 * Common functions for resolving services, images, and normalizing image references.
 * Used by both the /apply endpoint (applier.ts) and initialization (init.ts).
 */

import type { App, Intent } from "../types.ts";
import { logger } from "../utils/logger.ts";

/** Port binding configuration (for host port exposure, infrastructure only) */
export interface Port {
  host: number;
  container: number;
  protocol?: "tcp" | "udp";
}

export interface ResolvedService extends App {
  /** Service kind */
  kind: "infra" | "app";

  /** Resolved immutable image reference (with digest when available) */
  imageDigest: string;

  /** Port bindings to expose on host (infrastructure services only) */
  ports?: Port[];

  /** Unix user to run container as (only for app services) */
  user?: string;
}

/**
 * Rewrite image registry host to the internal registry service when it points
 * to the registry defined in the intent.
 */
export function rewriteRegistryToInternal(image: string, intent: Intent): string {
  const prefix = `${intent.registry.domain}/`;
  if (image.startsWith(prefix)) {
    return image.replace(prefix, "registry:5000/");
  }
  return image;
}

/**
 * Normalize image refs that target the local registry by accepting the
 * portable prefix "registry://" and replacing it with the registry domain from
 * the intent. The result is then rewritten to the in-cluster registry service.
 */
export function normalizeLocalRegistry(image: string, intent: Intent): string {
  const localPrefix = "registry://";
  const withDomain = image.startsWith(localPrefix)
    ? `${intent.registry.domain}/${image.slice(localPrefix.length)}`
    : image;
  return rewriteRegistryToInternal(withDomain, intent);
}

/**
 * Collect all unique domains from services
 */
export function collectDomains(services: ResolvedService[]): string[] {
  const domains = new Set<string>();
  for (const svc of services) {
    const ingressList = svc.ingress ?? [];
    for (const ingress of ingressList) {
      for (const domain of ingress.domains) {
        domains.add(domain);
      }
    }
  }
  return Array.from(domains);
}

/**
 * Resolve services from intent
 *
 * Unifies all deployable services (infrastructure and user apps) into a
 * consistent structure. Resolves semver ranges to immutable digests in parallel.
 */
export async function resolveServices(intent: Intent): Promise<ResolvedService[]> {
  const dataDir = intent.dataDir ?? "/var/infra";
  const services: ResolvedService[] = [];

  const baseEnvs = {
    OTEL_EXPORTER_OTLP_ENDPOINT: "http://otel-lgtm:4317",
  };

  // Add infrastructure services
  services.push({
    kind: "infra",
    name: "caddy",
    image: "caddy:2",
    imageDigest: "caddy:2",
    restart: "unless-stopped",
    ports: [
      { host: 80, container: 80 },
      { host: 443, container: 443 },
    ],
    volumes: [
      {
        type: "bind",
        source: `${dataDir}/Caddy.json`,
        target: "/etc/caddy/Caddy.json",
        readonly: true,
      },
      { type: "named", name: "caddy_data", target: "/data" },
      { type: "named", name: "caddy_config", target: "/config" },
    ],
    command: ["caddy", "run", "--config", "/etc/caddy/Caddy.json"],
    healthCheck: {
      path: "/",
      port: 80,
      interval: 10,
      timeout: 5,
      retries: 3,
    },
    env: {
      ...baseEnvs,
    },
  });

  services.push({
    kind: "infra",
    name: "registry",
    image: "registry:2",
    ingress: [{ domains: [intent.registry.domain], port: 5000 }],
    imageDigest: "registry:2",
    auth: {
      kind: "basic",
      username: intent.registry.username,
      passwordHash: intent.registry.passwordHash,
    },
    restart: "unless-stopped",
    volumes: [
      { type: "named", name: "registry_data", target: "/var/lib/registry" },
    ],
    env: {
      ...baseEnvs,
      REGISTRY_STORAGE_FILESYSTEM_ROOTDIRECTORY: "/var/lib/registry",
      REGISTRY_STORAGE_DELETE_ENABLED: "true",
    },
    healthCheck: {
      path: "/v2/",
      port: 5000,
      interval: 10,
      timeout: 5,
      retries: 3,
    },
  });

  const towerImage = `ghcr.io/dldc-packages/tower:${intent.tower.version}`;
  services.push({
    kind: "infra",
    name: "tower",
    image: towerImage,
    ingress: [{ domains: [intent.tower.domain], port: 3000 }],
    imageDigest: towerImage,
    auth: {
      kind: "basic",
      username: intent.tower.username,
      passwordHash: intent.tower.passwordHash,
    },
    restart: "unless-stopped",
    volumes: [
      { type: "bind", source: dataDir, target: dataDir },
      { type: "bind", source: "/var/run/docker.sock", target: "/var/run/docker.sock" },
    ],
    env: {
      ...baseEnvs,
      TOWER_DATA_DIR: dataDir,
      OTEL_DENO: "true",
      OTEL_DENO_CONSOLE: "capture",
    },
    healthCheck: {
      path: "/status",
      port: 3000,
      interval: 10,
      timeout: 5,
      retries: 3,
    },
  });

  const otelImage = `grafana/otel-lgtm:${intent.otel.version}`;
  services.push({
    kind: "infra",
    name: "otel-lgtm",
    image: otelImage,
    ingress: [{ domains: [intent.otel.domain], port: 3000 }],
    imageDigest: otelImage,
    restart: "unless-stopped",
    volumes: [
      { type: "named", name: "otel_lgtm_data", target: "/data" },
    ],
    healthCheck: {
      path: "/",
      port: 3000,
      interval: 10,
      timeout: 5,
      retries: 3,
    },
  });

  // Resolve all app images in parallel
  const appServices = await Promise.all(
    intent.apps.map(async (app): Promise<ResolvedService> => {
      const normalizedImageRef = normalizeLocalRegistry(app.image, intent);
      const resolvedImage = await resolveImageToDigest(normalizedImageRef, intent);

      if (resolvedImage) {
        logger.debug(`Resolved ${app.name}: ${app.image} → ${resolvedImage}`);
      }

      return {
        kind: "app",
        imageDigest: resolvedImage ?? normalizedImageRef,
        ...app,
        user: "1000:1000",
        env: {
          ...baseEnvs,
          ...app.env,
        },
      };
    }),
  );

  services.push(...appServices);

  return services;
}

/**
 * Resolve a single image reference to an immutable digest
 */
export async function resolveImageToDigest(
  imageRef: string,
  intent: Intent,
): Promise<string | null> {
  const { parseImageRef } = await import("./registry.ts");
  const { matchSemverRange } = await import("./semver.ts");
  const { createRegistryClient, listTags, getDigest } = await import("./registry.ts");

  try {
    const parsed = parseImageRef(imageRef);

    // If already has a digest, return as-is
    if (parsed.digest) {
      return imageRef;
    }

    // If no tag or tag doesn't look like semver, return as-is
    if (!parsed.tag || !isSemverLike(parsed.tag)) {
      logger.debug(`Image ${imageRef} doesn't use semver, skipping resolution`);
      return null;
    }

    // Determine if this is the internal registry
    const isInternalRegistry = parsed.registry === "registry" ||
      parsed.registry === intent.registry.domain;

    // Create registry client
    const baseUrl = isInternalRegistry ? "http://registry:5000" : `https://${parsed.registry}`;

    const client = createRegistryClient(baseUrl);

    // List available tags
    const tags = await listTags(client, parsed.repository);

    // Match semver range to available tags
    const matchedTag = matchSemverRange(parsed.tag, tags);

    if (!matchedTag) {
      logger.warn(`No matching tag found for ${imageRef}, using original`);
      return null;
    }

    // Get digest for matched tag
    const digest = await getDigest(client, parsed.repository, matchedTag);

    // Return full image reference with digest
    return `${parsed.registry}/${parsed.repository}@${digest}`;
  } catch (error) {
    logger.warn(`Failed to resolve ${imageRef}:`, error);
    return null;
  }
}

/**
 * Check if a tag looks like it might be a semver range
 */
export function isSemverLike(tag: string): boolean {
  // Check for semver patterns: ^1.2.3, ~1.2.3, 1.2.*, >=1.2.3, etc.
  return /^[~^>=<]?\d+(\.\d+)?(\.\d+)?/.test(tag);
}
