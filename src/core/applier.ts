/**
 * Apply orchestration logic
 *
 * Coordinates the full deployment flow from intent to running services.
 */

import type { HealthCheck, Intent } from "@dldc/tower/types";
import { logger } from "../utils/logger.ts";
import { validateDns } from "./dns.ts";
import { validateIntent } from "./validator.ts";

/**
 * Rewrite image registry host to the internal registry service when it points
 * to the registry defined in the intent.
 */
function rewriteRegistryToInternal(image: string, intent: Intent): string {
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
function normalizeLocalRegistry(image: string, intent: Intent): string {
  const localPrefix = "registry://";
  const withDomain = image.startsWith(localPrefix)
    ? `${intent.registry.domain}/${image.slice(localPrefix.length)}`
    : image;
  return rewriteRegistryToInternal(withDomain, intent);
}

/** * Represents a resolved service (infrastructure or application)
 */
interface ResolvedService {
  /** Service name */
  name: string;

  /** Service type: infrastructure or user-defined application */
  type: "infra" | "app";

  /** Primary domain */
  domain: string;

  /** Listening port */
  port: number;

  /** Version (semver, exact version, or digest) */
  version: string;

  /** Docker image reference */
  image: string;

  /** Non-sensitive environment variables */
  env?: Record<string, string>;

  /** Sensitive environment variables */
  secrets?: Record<string, string>;

  /** Health check configuration */
  healthCheck?: HealthCheck;
}

/** * Apply deployment intent
 *
 * Steps:
 * 1. Validate intent
 * 2. Resolve services (infra + apps)
 * 3. Resolve semver ranges to digests
 * 4. Validate DNS for new domains
 * 5. Generate docker-compose.yml and Caddyfile
 * 6. Validate generated configs
 * 7. Apply via docker compose up
 * 8. Wait for health checks
 * 9. Reload Caddy
 * 10. Save intent.json
 */
export async function apply(intent: Intent): Promise<void> {
  logger.info("🚀 Starting deployment");

  // Step 1: Validate intent
  const validatedIntent = validateIntent(intent);
  logger.info("✓ Intent validated");

  // Step 2: Resolve services
  const services = resolveServices(validatedIntent);
  logger.info(`✓ Resolved ${services.length} service(s)`);

  // Step 4: Validate DNS for all domains (naive parallel check)
  const domains = collectDomains(services);
  await validateDns(domains);

  // TODO: Implement remaining steps
  // See BLUEPRINT.md "Apply Flow" section for detailed steps

  const appCount = services.filter((s) => s.type === "app").length;
  logger.info(`Deploying ${appCount} app(s)`);
}

function collectDomains(services: ResolvedService[]): string[] {
  const domains = new Set<string>();
  for (const svc of services) {
    if (svc.domain) domains.add(svc.domain);
  }
  return Array.from(domains);
}

/**
 * Resolve services from intent
 *
 * Unifies all deployable services (infrastructure and user apps) into a
 * consistent structure for downstream processing (semver resolution, composition
 * generation, etc.).
 */
function resolveServices(intent: Intent): ResolvedService[] {
  const services: ResolvedService[] = [];

  // Add infrastructure services
  services.push({
    name: "caddy",
    type: "infra",
    domain: intent.tower.domain,
    port: 80,
    version: "latest",
    image: "caddy:latest",
  });

  services.push({
    name: "registry",
    type: "infra",
    domain: intent.registry.domain,
    port: 5000,
    version: "latest",
    image: "registry:2",
  });

  services.push({
    name: "tower",
    type: "infra",
    domain: intent.tower.domain,
    port: 3000,
    version: intent.tower.version,
    image: `dldc/tower:${intent.tower.version}`,
    env: {
      OTEL_DENO: "true",
      OTEL_DENO_CONSOLE: "capture",
    },
  });

  services.push({
    name: "otel",
    type: "infra",
    domain: intent.otel.domain,
    port: 3000,
    version: intent.otel.version,
    image: `grafana/otel-lgtm:${intent.otel.version}`,
  });

  // Add user-defined apps
  for (const app of intent.apps) {
    const image = normalizeLocalRegistry(app.image, intent);
    services.push({
      name: app.name,
      type: "app",
      domain: app.domain,
      port: app.port ?? 3000,
      version: app.image,
      image,
      env: app.env,
      secrets: app.secrets,
      healthCheck: app.healthCheck,
    });
  }

  return services;
}

/**
 * Resolve semver ranges in intent to immutable digests
 */
function _resolveSemver(_intent: Intent): Map<string, string> {
  // TODO:
  // 1. Parse image refs
  // 2. For each with semver range:
  //    - Query registry for tags
  //    - Match range to tags
  //    - Get digest for matched tag
  // 3. Return map of app name → resolved image@digest

  throw new Error("Not implemented");
}

/**
 * Wait for all services to report healthy
 */
function _waitForHealthy(_services: string[], _timeoutSeconds: number): void {
  // TODO:
  // 1. Poll docker inspect for health status
  // 2. Wait until all services are "healthy"
  // 3. Timeout if any service fails health checks

  throw new Error("Not implemented");
}
