/**
 * Apply orchestration logic
 *
 * Coordinates the full deployment flow from intent to running services.
 */

import type { Credentials, Intent } from "@dldc/tower/types";
import { DEFAULT_DATA_DIR } from "../config.ts";
import { generateCaddyJson } from "../generators/caddy.ts";
import { generateCompose } from "../generators/compose.ts";
import { composeUp, validateCompose } from "../utils/exec.ts";
import { readJsonFile, writeTextFile } from "../utils/fs.ts";
import { logger } from "../utils/logger.ts";
import { loadCaddyConfig } from "./caddyAdmin.ts";
import { validateDns } from "./dns.ts";
import { waitForHealthy } from "./health.ts";
import type { ResolvedService } from "./types.ts";
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

/** * Apply deployment intent
 *
 * Steps:
 * 1. Validate intent
 * 2. Resolve services (infra + apps)
 * 3. Resolve semver ranges to digests
 * 4. Validate DNS for new domains
 * 5. Generate docker-compose.yml and Caddy.json
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

  const dataDir = validatedIntent.dataDir ?? DEFAULT_DATA_DIR;
  const credentials = await loadCredentials(dataDir);

  // Step 2: Resolve services
  const services = resolveServices(validatedIntent, credentials);
  logger.info(`✓ Resolved ${services.length} service(s)`);

  // Step 3: Resolve semver ranges to digests
  const resolvedImages = await resolveSemver(validatedIntent);
  logger.info(`✓ Resolved ${resolvedImages.size} image(s) to digests`);

  // Step 4: Validate DNS for all domains (naive parallel check)
  const domains = collectDomains(services);
  await validateDns(domains);

  // Step 5: Generate docker-compose.yml and Caddy.json
  const composeYaml = generateCompose(validatedIntent, resolvedImages);
  const composePath = `${dataDir}/docker-compose.yml`;

  const caddyJson = generateCaddyJson(services, validatedIntent.adminEmail);
  const caddyPath = `${dataDir}/Caddy.json`;

  // Step 6: Validate generated configs (before writing to disk)
  // Write to temp file for validation
  const tempComposePath = `${dataDir}/.docker-compose.yml.tmp`;
  await writeTextFile(tempComposePath, composeYaml);

  try {
    await validateCompose(tempComposePath);
    logger.info("✓ docker-compose.yml validated");

    // Validation passed, write final file
    await writeTextFile(composePath, composeYaml);
    logger.info(`✓ Wrote docker-compose.yml to ${dataDir}`);

    // Clean up temp file
    await Deno.remove(tempComposePath).catch(() => {});
  } catch (error) {
    await Deno.remove(tempComposePath).catch(() => {});
    throw new Error(`docker-compose.yml validation failed`, { cause: error });
  }

  await writeTextFile(caddyPath, caddyJson);
  logger.info(`✓ Wrote Caddy.json to ${dataDir}`);

  // Step 7: Apply via docker compose up
  await composeUp(composePath);
  logger.info("✓ Applied docker-compose.yml");

  // Step 8: Wait for health checks
  const containerNames = services.map((s) => s.name);
  await waitForHealthy(containerNames, 60);
  logger.info("✓ All containers healthy");

  // Step 9: Reload Caddy (validate and load config via admin API)
  await loadCaddyConfig(caddyJson);
  logger.info("✓ Reloaded Caddy via admin API");

  // Step 10: Save applied intent with resolved images
  const appliedIntent = {
    ...validatedIntent,
    appliedAt: new Date().toISOString(),
    resolvedImages: Object.fromEntries(resolvedImages),
  };
  await writeTextFile(`${dataDir}/intent.json`, JSON.stringify(appliedIntent, null, 2));
  logger.info("✓ Saved applied intent");

  const appCount = services.filter((s) => s.type === "app").length;
  logger.info(`✅ Deployment complete: ${appCount} app(s) running`);
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
function resolveServices(intent: Intent, credentials: Credentials): ResolvedService[] {
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
    upstreamName: "registry",
    upstreamPort: 5000,
    authPolicy: "basic_write_only",
    authBasicUsers: [
      {
        username: credentials.registry.username,
        passwordHash: credentials.registry.password_hash,
      },
    ],
  });

  services.push({
    name: "tower",
    type: "infra",
    domain: intent.tower.domain,
    port: 3000,
    version: intent.tower.version,
    image: `ghcr.io/dldc-packages/tower:${intent.tower.version}`,
    upstreamName: "tower",
    upstreamPort: 3100,
    authPolicy: "basic_all",
    authBasicUsers: [
      {
        username: credentials.tower.username,
        passwordHash: credentials.tower.password_hash,
      },
    ],
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
    upstreamName: "otel-lgtm",
    upstreamPort: 3000,
    authPolicy: "none",
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
      upstreamName: app.name,
      upstreamPort: app.port ?? 3000,
      authPolicy: "none",
      env: app.env,
      secrets: app.secrets,
      healthCheck: app.healthCheck,
    });
  }

  return services;
}

async function loadCredentials(dataDir: string): Promise<Credentials> {
  const path = `${dataDir}/credentials.json`;
  logger.info("Loading credentials from", path);
  return await readJsonFile<Credentials>(path);
}

/**
 * Resolve semver ranges in intent to immutable digests
 */
async function resolveSemver(intent: Intent): Promise<Map<string, string>> {
  const resolvedImages = new Map<string, string>();

  for (const app of intent.apps) {
    const image = normalizeLocalRegistry(app.image, intent);
    const resolved = await resolveImageToDigest(image, intent);
    if (resolved) {
      resolvedImages.set(app.name, resolved);
      logger.debug(`Resolved ${app.name}: ${app.image} → ${resolved}`);
    }
  }

  return resolvedImages;
}

/**
 * Resolve a single image reference to an immutable digest
 */
async function resolveImageToDigest(imageRef: string, intent: Intent): Promise<string | null> {
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
function isSemverLike(tag: string): boolean {
  // Check for semver patterns: ^1.2.3, ~1.2.3, 1.2.*, >=1.2.3, etc.
  return /^[~^>=<]?\d+(\.\d+)?(\.\d+)?/.test(tag);
}
