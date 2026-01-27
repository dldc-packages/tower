/**
 * Tower initialization command
 *
 * Performs one-time bootstrap of Tower infrastructure.
 */

import { hash } from "@felix/bcrypt";
import { parseArgs } from "@std/cli/parse-args";
import denoJson from "../../deno.json" with { type: "json" };
import { DEFAULT_DATA_DIR } from "../config.ts";
import { waitForHealthy } from "../core/health.ts";
import { generateBootstrapCompose } from "../generators/compose.ts";
import type { Intent } from "../types.ts";
import {
  checkDocker,
  checkDockerCompose,
  composeConfig,
  composeUp,
  execOrThrow,
} from "../utils/exec.ts";
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
 * 5. Bootstrap the stack (apply initial config with credentials)
 * 6. Print summary
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

  // Step 5: Bootstrap tower-only compose and call /apply inside the container
  logger.info("");
  await bootstrapAndApply(intent, dataDir);

  // Step 6: Wait for services to be healthy
  logger.info("");
  logger.info("Waiting for services to start...");
  await waitForHealthy(["tower", "caddy", "registry", "otel-lgtm"], 120);

  // Step 7: Clean up bootstrap network
  logger.info("");
  logger.info("Cleaning up bootstrap resources...");
  await cleanupBootstrap(dataDir);

  // Step 8: Print final summary
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
    throw new Error(`Docker socket permission denied: ${error}`);
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
 * Apply the initial Tower stack
 */
async function bootstrapAndApply(intent: Intent, dataDir: string): Promise<void> {
  logger.info("Bootstrapping tower-only compose...");

  const composePath = `${dataDir}/docker-compose.bootstrap.yml`;
  const composeContent = generateBootstrapCompose(dataDir, denoJson.version);
  await writeTextFile(composePath, composeContent);

  await composeConfig(composePath);
  await composeUp(composePath);

  await waitForHealthy(["tower"], 60);

  logger.info("Calling tower /apply via docker network (no host port exposure)...");
  await callTowerApply(intent, dataDir);
}

async function callTowerApply(intent: Intent, _dataDir: string): Promise<void> {
  const intentJson = JSON.stringify(intent);

  // Use Deno.Command to pipe intent JSON to docker exec
  const command = new Deno.Command("docker", {
    args: [
      "exec",
      "-i",
      "tower",
      "deno",
      "run",
      "--allow-all",
      "/usr/local/bin/tower",
      "apply",
    ],
    stdin: "piped",
    stdout: "inherit",
    stderr: "inherit",
  });

  const process = command.spawn();
  const writer = process.stdin.getWriter();

  try {
    await writer.write(new TextEncoder().encode(intentJson));
    await writer.close();
  } catch (error) {
    logger.error("Failed to write intent to apply command:", error);
    throw error;
  }

  const { success } = await process.output();
  if (!success) {
    throw new Error("Apply command failed");
  }

  logger.info("✓ Apply completed");
}

/**
 * Clean up bootstrap resources
 */
async function cleanupBootstrap(dataDir: string): Promise<void> {
  try {
    // Remove bootstrap compose file
    const bootstrapCompose = `${dataDir}/docker-compose.bootstrap.yml`;
    await Deno.remove(bootstrapCompose).catch(() => {});

    // Remove temporary intent file
    const tempIntent = `${dataDir}/.intent.bootstrap.json`;
    await Deno.remove(tempIntent).catch(() => {});

    // Stop and remove bootstrap container
    await execOrThrow(["docker", "stop", "tower"]).catch(() => {});
    await execOrThrow(["docker", "rm", "tower"]).catch(() => {});

    // Remove bootstrap network
    await execOrThrow(["docker", "network", "rm", "tower_bootstrap"]).catch(() => {});

    logger.info("✓ Bootstrap cleanup complete");
  } catch (error) {
    logger.warn("Failed to clean up some bootstrap resources:", error);
  }
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
  logger.error("Init failed:", error);
  Deno.exit(1);
}
