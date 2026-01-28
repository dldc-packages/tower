/**
 * Tower initialization command
 *
 * Performs one-time setup of Tower infrastructure by generating production
 * configs directly and starting the full stack.
 */

import { hash } from "@felix/bcrypt";
import { parseArgs } from "@std/cli/parse-args";
import denoJson from "../../deno.json" with { type: "json" };
import { DEFAULT_DATA_DIR } from "../config.ts";
import { validateDns } from "../core/dns.ts";
import { waitForHealthy } from "../core/health.ts";
import type { ResolvedService } from "../core/types.ts";
import { generateCaddyJson } from "../generators/caddy.ts";
import { generateCompose } from "../generators/compose.ts";
import type { Credentials, Intent } from "../types.ts";
import { checkDocker, checkDockerCompose, composeUp, validateCompose } from "../utils/exec.ts";
import { ensureDir, fileExists, writeTextFile } from "../utils/fs.ts";
import { logger } from "../utils/logger.ts";

export interface InitOptions {
  dataDir?: string;
}

/**
 * Run Tower initialization flow
 *
 * Steps:
 * 1. Check prerequisites (Docker, Compose)
 * 2. Load configuration from environment variables
 * 3. Hash credentials from environment variables
 * 4. Generate initial intent with credentials embedded
 * 5. Generate production configs and start stack directly
 * 6. Wait for services to be healthy
 * 7. Print summary
 */
export async function runInit(options: InitOptions = {}): Promise<void> {
  const dataDir = options.dataDir ?? DEFAULT_DATA_DIR;

  logger.info("🗼 Tower Initialization");
  logger.info("");

  // Step 1: Check prerequisites
  await checkPrerequisites();

  // Step 2: Load configuration from environment variables
  logger.info("");
  const config = loadConfigurationFromEnv();

  // Step 3: Hash credentials from environment variables
  logger.info("");
  const hashedCredentials = await hashCredentialsFromEnv();

  // Step 4: Generate initial intent with credentials
  logger.info("");
  const intent = generateInitialIntent(config, dataDir, hashedCredentials);
  logger.info("✓ Initial intent generated");

  // Step 5: Generate production configs and start stack
  logger.info("");
  await applyInitialStack(intent, dataDir, hashedCredentials);

  // Step 6: Wait for services to be healthy
  logger.info("");
  logger.info("Waiting for services to start...");
  await waitForHealthy(["tower", "caddy", "registry", "otel-lgtm"], 120);

  // Step 7: Print final summary
  logger.info("");
  printSummary(intent);
}

/**
 * Check if Docker and Docker Compose are installed
 */
async function checkPrerequisites(): Promise<void> {
  logger.info("Checking prerequisites...");

  // Check Docker
  const hasDocker = await checkDocker();
  if (!hasDocker) {
    logger.error("❌ Docker is not installed or not available");
    logger.info("Please install Docker: https://docs.docker.com/get-docker/");
    throw new Error("Docker not found");
  }
  logger.info("  ✓ Docker is installed");

  // Check Docker Compose
  const hasCompose = await checkDockerCompose();
  if (!hasCompose) {
    logger.error("❌ Docker Compose is not available");
    logger.info("Please install Docker Compose v2 (comes with Docker Desktop)");
    logger.info("Or install the plugin: https://docs.docker.com/compose/install/");
    throw new Error("Docker Compose not found");
  }
  logger.info("  ✓ Docker Compose is available");

  // Check Docker socket permissions
  const socketPath = "/var/run/docker.sock";
  const hasSocket = await fileExists(socketPath);
  if (!hasSocket) {
    logger.error(`❌ Docker socket not found at ${socketPath}`);
    logger.info("Make sure Docker daemon is running");
    throw new Error("Docker socket not accessible");
  }

  // Try to access docker (this will fail if permissions are wrong)
  try {
    const { exec } = await import("../utils/exec.ts");
    const result = await exec(["docker", "ps"]);
    if (!result.success) {
      throw new Error(result.stderr);
    }
    logger.info("  ✓ Docker socket is accessible");
  } catch (error) {
    logger.error("❌ Cannot access Docker socket");
    logger.info("You may need to run this command with sudo or add your user to the docker group");
    logger.info("See: https://docs.docker.com/engine/install/linux-postinstall/");
    throw new Error(`Docker socket permission denied`, { cause: error });
  }
}

/**
 * Load Tower configuration from environment variables
 */
function loadConfigurationFromEnv(): {
  adminEmail: string;
  towerDomain: string;
  registryDomain: string;
  otelDomain: string;
} {
  logger.info("Loading configuration from environment variables...");

  const adminEmail = Deno.env.get("ADMIN_EMAIL");
  const towerDomain = Deno.env.get("TOWER_DOMAIN");
  const registryDomain = Deno.env.get("REGISTRY_DOMAIN");
  const otelDomain = Deno.env.get("OTEL_DOMAIN");

  if (!adminEmail || !adminEmail.includes("@") || !adminEmail.includes(".")) {
    throw new Error("Invalid or missing ADMIN_EMAIL environment variable");
  }
  if (!towerDomain || !isValidDomain(towerDomain)) {
    throw new Error("Invalid or missing TOWER_DOMAIN environment variable");
  }
  if (!registryDomain || !isValidDomain(registryDomain)) {
    throw new Error("Invalid or missing REGISTRY_DOMAIN environment variable");
  }
  if (!otelDomain || !isValidDomain(otelDomain)) {
    throw new Error("Invalid or missing OTEL_DOMAIN environment variable");
  }

  logger.info("  ✓ Configuration loaded from environment");

  return {
    adminEmail,
    towerDomain,
    registryDomain,
    otelDomain,
  };
}

/**
 * Validate domain format
 */
function isValidDomain(domain: string): boolean {
  // Basic domain validation - allows subdomains
  const domainRegex =
    /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;
  return domainRegex.test(domain);
}

/**
 * Hash credentials from environment variables
 */
async function hashCredentialsFromEnv(): Promise<{
  tower: { username: string; passwordHash: string };
  registry: { username: string; passwordHash: string };
  otel: { username: string; passwordHash: string };
}> {
  logger.info("Hashing credentials from environment variables...");

  const towerPassword = Deno.env.get("TOWER_PASSWORD");
  const registryPassword = Deno.env.get("REGISTRY_PASSWORD");

  const MIN_PASSWORD_LENGTH = 16;

  if (!towerPassword || towerPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `Invalid or missing TOWER_PASSWORD environment variable (must be at least ${MIN_PASSWORD_LENGTH} characters)`,
    );
  }
  if (!registryPassword || registryPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `Invalid or missing REGISTRY_PASSWORD environment variable (must be at least ${MIN_PASSWORD_LENGTH} characters)`,
    );
  }

  // Hash passwords with bcrypt
  const towerHash = await hash(towerPassword);
  const registryHash = await hash(registryPassword);
  const otelHash = await hash(registryPassword); // OTEL uses same password as registry for now

  logger.info("  ✓ Credentials hashed");

  return {
    tower: {
      username: "tower",
      passwordHash: towerHash,
    },
    registry: {
      username: "ci",
      passwordHash: registryHash,
    },
    otel: {
      username: "admin",
      passwordHash: otelHash,
    },
  };
}

/**
 * Load credentials from environment variables (deprecated - kept for compatibility)
 */
async function _loadCredentialsFromEnv(
  dataDir: string,
): Promise<{
  towerPassword: string;
  registryPassword: string;
}> {
  // Create data directory if it doesn't exist
  await ensureDir(dataDir);

  const towerPassword = Deno.env.get("TOWER_PASSWORD");
  const registryPassword = Deno.env.get("REGISTRY_PASSWORD");

  const MIN_PASSWORD_LENGTH = 16;

  if (!towerPassword || towerPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `Invalid or missing TOWER_PASSWORD environment variable (must be at least ${MIN_PASSWORD_LENGTH} characters)`,
    );
  }
  if (!registryPassword || registryPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `Invalid or missing REGISTRY_PASSWORD environment variable (must be at least ${MIN_PASSWORD_LENGTH} characters)`,
    );
  }

  // Hash passwords with bcrypt
  const towerHash = await hash(towerPassword);
  const registryHash = await hash(registryPassword);

  return {
    towerPassword: towerHash,
    registryPassword: registryHash,
  };
}

/**
 * Generate initial intent.json configuration with credentials
 */
function generateInitialIntent(
  config: {
    adminEmail: string;
    towerDomain: string;
    registryDomain: string;
    otelDomain: string;
  },
  dataDir: string,
  credentials: {
    tower: { username: string; passwordHash: string };
    registry: { username: string; passwordHash: string };
    otel: { username: string; passwordHash: string };
  },
): Intent {
  const intent: Intent = {
    version: "1",
    adminEmail: config.adminEmail,
    tower: {
      version: denoJson.version,
      domain: config.towerDomain,
      username: credentials.tower.username,
      passwordHash: credentials.tower.passwordHash,
    },
    registry: {
      domain: config.registryDomain,
      username: credentials.registry.username,
      passwordHash: credentials.registry.passwordHash,
    },
    otel: {
      version: "latest",
      domain: config.otelDomain,
      username: credentials.otel.username,
      passwordHash: credentials.otel.passwordHash,
    },
    apps: [], // Empty initially - apps added via deployments
  };

  // Store dataDir only if different from default
  if (dataDir !== DEFAULT_DATA_DIR) {
    intent.dataDir = dataDir;
  }

  return intent;
}

/**
 * Apply the initial Tower stack by generating production configs directly
 */
async function applyInitialStack(
  intent: Intent,
  dataDir: string,
  hashedCredentials: {
    tower: { username: string; passwordHash: string };
    registry: { username: string; passwordHash: string };
    otel: { username: string; passwordHash: string };
  },
): Promise<void> {
  logger.info("Generating production configuration...");

  // Build credentials object
  const credentials: Credentials = {
    tower: {
      username: hashedCredentials.tower.username,
      password_hash: hashedCredentials.tower.passwordHash,
    },
    registry: {
      username: hashedCredentials.registry.username,
      password_hash: hashedCredentials.registry.passwordHash,
    },
  };

  // Step 1: Resolve services (same as /apply does)
  const services = resolveServices(intent, credentials);
  logger.info(`✓ Resolved ${services.length} service(s)`);

  // Step 2: Resolve semver ranges to digests
  const resolvedImages = await resolveSemver(intent);
  logger.info(`✓ Resolved ${resolvedImages.size} image(s) to digests`);

  // Step 3: Validate DNS for all domains
  const domains = collectDomains(services);
  await validateDns(domains);

  // Step 4: Generate docker-compose.yml and Caddy.json
  const composeYaml = generateCompose(intent, resolvedImages);
  const composePath = `${dataDir}/docker-compose.yml`;

  const caddyJson = generateCaddyJson(services, intent.adminEmail);
  const caddyPath = `${dataDir}/Caddy.json`;

  // Step 5: Validate generated compose config
  const tempComposePath = `${dataDir}/.docker-compose.yml.tmp`;
  await writeTextFile(tempComposePath, composeYaml);

  try {
    await validateCompose(tempComposePath);
    logger.info("✓ docker-compose.yml validated");

    // Validation passed, write final files
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

  // Step 6: Save credentials.json for Tower to read
  const credentialsPath = `${dataDir}/credentials.json`;
  await writeTextFile(credentialsPath, JSON.stringify(credentials, null, 2));
  logger.info(`✓ Wrote credentials.json to ${dataDir}`);

  // Step 7: Save initial intent.json
  const appliedIntent = {
    ...intent,
    appliedAt: new Date().toISOString(),
    resolvedImages: Object.fromEntries(resolvedImages),
  };
  await writeTextFile(`${dataDir}/intent.json`, JSON.stringify(appliedIntent, null, 2));
  logger.info(`✓ Wrote intent.json to ${dataDir}`);

  // Step 8: Start the production stack
  logger.info("");
  logger.info("Starting production stack...");
  await composeUp(composePath);
  logger.info("✓ Production stack started");
}

/**
 * Collect all unique domains from services
 */
function collectDomains(services: ResolvedService[]): string[] {
  const domains = new Set<string>();
  for (const svc of services) {
    if (svc.domain) domains.add(svc.domain);
  }
  return Array.from(domains);
}

/**
 * Resolve services from intent (infrastructure + apps)
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

/**
 * Normalize registry:// prefix to registry domain
 */
function normalizeLocalRegistry(image: string, intent: Intent): string {
  const localPrefix = "registry://";
  const withDomain = image.startsWith(localPrefix)
    ? `${intent.registry.domain}/${image.slice(localPrefix.length)}`
    : image;
  return rewriteRegistryToInternal(withDomain, intent);
}

/**
 * Rewrite registry domain to internal service name
 */
function rewriteRegistryToInternal(image: string, intent: Intent): string {
  const prefix = `${intent.registry.domain}/`;
  if (image.startsWith(prefix)) {
    return image.replace(prefix, "registry:5000/");
  }
  return image;
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
  const { parseImageRef } = await import("../core/registry.ts");
  const { matchSemverRange } = await import("../core/semver.ts");
  const { createRegistryClient, listTags, getDigest } = await import("../core/registry.ts");

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

/**
 * Print initialization summary
 */
function printSummary(intent: Intent): void {
  logger.info("✓ Tower initialization complete!");
  logger.info("");
  logger.info("Base intent.json:");
  logger.info(JSON.stringify(intent, null, 2));
  logger.info("");
  logger.info("Next steps:");
  logger.info("  1. Configure DNS records to point to this server:");
  logger.info(`     - ${intent.tower.domain} → this server's IP`);
  logger.info(`     - ${intent.registry.domain} → this server's IP`);
  logger.info(`     - ${intent.otel.domain} → this server's IP`);
  logger.info("  2. Wait for Let's Encrypt SSL certificates to be issued (may take a few minutes)");
  logger.info("  3. Access Tower API at https://" + intent.tower.domain);
  logger.info("  4. Access Grafana at https://" + intent.otel.domain);
  logger.info("");
  logger.info("For more information, visit: https://jsr.io/@dldc/tower");
}

if (!import.meta.main) throw new Error("This module must be run as the main module");

const args = parseArgs(Deno.args, {
  string: ["data-dir"],
  boolean: ["help"],
  alias: {
    h: "help",
    d: "data-dir",
  },
});

if (args.help) {
  console.log(`
Tower Init - Bootstrap Tower infrastructure

USAGE:
  init [options]

OPTIONS:
  -d, --data-dir    Data directory (default: /var/infra)
  -h, --help        Show this help message

REQUIRED ENVIRONMENT VARIABLES:
  ADMIN_EMAIL          Administrator email address
  TOWER_DOMAIN         Domain for Tower HTTP server
  REGISTRY_DOMAIN      Domain for Docker registry
  OTEL_DOMAIN          Domain for OTEL observability
  TOWER_PASSWORD       Tower admin password (min 16 chars)
  REGISTRY_PASSWORD    Registry password (min 16 chars)

EXAMPLE:
  docker run --rm -it \\
    -v /var/run/docker.sock:/var/run/docker.sock \\
    -v /var/infra:/var/infra \\
    -e ADMIN_EMAIL=admin@example.com \\
    -e TOWER_DOMAIN=tower.example.com \\
    -e REGISTRY_DOMAIN=registry.example.com \\
    -e OTEL_DOMAIN=otel.example.com \\
    -e TOWER_PASSWORD=mysecurepassword \\
    -e REGISTRY_PASSWORD=mysecurepassword \\
    ghcr.io/dldc-packages/tower:latest
`);
  Deno.exit(0);
}

try {
  const dataDir = args["data-dir"] as string | undefined;
  await runInit({ dataDir });
} catch (error) {
  logger.error("Init failed:", error instanceof Error ? error.message : String(error));
  if (error instanceof Error && error.stack) {
    logger.debug(error.stack);
  }
  Deno.exit(1);
}
