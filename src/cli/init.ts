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
import { collectDomains, resolveServices } from "../core/services.ts";

import { generateCaddyJson } from "../generators/caddy.ts";
import { generateCompose } from "../generators/compose.ts";
import type { Intent } from "../types.ts";
import {
  checkDocker,
  checkDockerCompose,
  composeUpWithWait,
  validateCompose,
} from "../utils/exec.ts";
import { fileExists, writeTextFile } from "../utils/fs.ts";

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

  console.log("🗼 Tower Initialization");
  console.log("");

  // Step 1: Check prerequisites
  await checkPrerequisites();

  // Step 2: Load configuration from environment variables
  console.log("");
  const config = loadConfigurationFromEnv();

  // Step 3: Hash credentials from environment variables
  console.log("");
  const hashedCredentials = await hashCredentialsFromEnv();

  // Step 4: Generate initial intent with credentials
  console.log("");
  const intent = generateInitialIntent(config, dataDir, hashedCredentials);
  console.log("✓ Initial intent generated");

  // Step 5: Generate production configs and start stack
  console.log("");
  await applyInitialStack(intent, dataDir);

  // Step 6: Print final summary
  console.log("");
  printSummary(intent);
}

/**
 * Check if Docker and Docker Compose are installed
 */
async function checkPrerequisites(): Promise<void> {
  console.log("Checking prerequisites...");

  // Check Docker
  const hasDocker = await checkDocker();
  if (!hasDocker) {
    console.error("❌ Docker is not installed or not available");
    console.log("Please install Docker: https://docs.docker.com/get-docker/");
    throw new Error("Docker not found");
  }
  console.log("  ✓ Docker is installed");

  // Check Docker Compose
  const hasCompose = await checkDockerCompose();
  if (!hasCompose) {
    console.error("❌ Docker Compose is not available");
    console.log("Please install Docker Compose v2 (comes with Docker Desktop)");
    console.log("Or install the plugin: https://docs.docker.com/compose/install/");
    throw new Error("Docker Compose not found");
  }
  console.log("  ✓ Docker Compose is available");

  // Check Docker socket permissions
  const socketPath = "/var/run/docker.sock";
  const hasSocket = await fileExists(socketPath);
  if (!hasSocket) {
    console.error(`❌ Docker socket not found at ${socketPath}`);
    console.log("Make sure Docker daemon is running");
    throw new Error("Docker socket not accessible");
  }

  // Try to access docker (this will fail if permissions are wrong)
  try {
    const { exec } = await import("../utils/exec.ts");
    const result = await exec(["docker", "ps"]);
    if (!result.success) {
      throw new Error(result.stderr);
    }
    console.log("  ✓ Docker socket is accessible");
  } catch (error) {
    console.error("❌ Cannot access Docker socket");
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
  console.log("Loading configuration from environment variables...");

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

  console.log("  ✓ Configuration loaded from environment");

  return { adminEmail, towerDomain, registryDomain, otelDomain };
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
  tower: string;
  registry: string;
}> {
  console.log("Hashing credentials from environment variables...");

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

  console.log("  ✓ Credentials hashed");

  return {
    tower: towerHash,
    registry: registryHash,
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
  credentials: { tower: string; registry: string },
): Intent {
  const intent: Intent = {
    version: "1",
    adminEmail: config.adminEmail,
    tower: {
      version: denoJson.version,
      domain: config.towerDomain,
      username: "admin",
      passwordHash: credentials.tower,
    },
    registry: {
      domain: config.registryDomain,
      username: "admin",
      passwordHash: credentials.registry,
    },
    otel: {
      version: "latest",
      domain: config.otelDomain,
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
): Promise<void> {
  console.log("Generating production configuration...");

  // Step 1: Resolve services (includes image resolution)
  const services = await resolveServices(intent);
  console.log(`✓ Resolved ${services.length} service(s)`);

  // Step 2: Validate DNS for all domains
  const domains = collectDomains(services);
  await validateDns(domains);

  // Step 3: Generate docker-compose.yml and Caddy.json
  const composeYaml = generateCompose(services);
  const composePath = `${dataDir}/docker-compose.yml`;

  const caddyJson = generateCaddyJson(services, intent.adminEmail);
  const caddyPath = `${dataDir}/Caddy.json`;

  // Step 4: Validate generated compose config
  const tempComposePath = `${dataDir}/.docker-compose.yml.tmp`;
  await writeTextFile(tempComposePath, composeYaml);

  try {
    await validateCompose(tempComposePath);
    console.log("✓ docker-compose.yml validated");

    // Validation passed, write final files
    await writeTextFile(composePath, composeYaml);
    console.log(`✓ Wrote docker-compose.yml to ${dataDir}`);

    // Clean up temp file
    await Deno.remove(tempComposePath).catch(() => {});
  } catch (error) {
    await Deno.remove(tempComposePath).catch(() => {});
    throw new Error(`docker-compose.yml validation failed`, { cause: error });
  }

  await writeTextFile(caddyPath, caddyJson);
  console.log(`✓ Wrote Caddy.json to ${dataDir}`);

  // Step 5: Save initial intent.json
  await writeTextFile(`${dataDir}/intent.json`, JSON.stringify(intent, null, 2));
  console.log(`✓ Wrote intent.json to ${dataDir}`);

  // Step 6: Start the production stack (with health check waiting)
  console.log("");
  console.log("Starting production stack...");
  await composeUpWithWait(composePath);
  console.log("✓ Production stack started and all services healthy");
}

/**
 * Print initialization summary
 */
function printSummary(intent: Intent): void {
  console.log("✓ Tower initialization complete!");
  console.log("");
  console.log("Base intent.json:");
  console.log(JSON.stringify(intent, null, 2));
  console.log("");
  console.log("Next steps:");
  console.log("  1. Configure DNS records to point to this server:");
  console.log(`     - ${intent.tower.domain} → this server's IP`);
  console.log(`     - ${intent.registry.domain} → this server's IP`);
  console.log(`     - ${intent.otel.domain} → this server's IP`);
  console.log("  2. Wait for Let's Encrypt SSL certificates to be issued (may take a few minutes)");
  console.log("  3. Access Tower API at https://" + intent.tower.domain);
  console.log("  4. Access Grafana at https://" + intent.otel.domain);
  console.log("");
  console.log("For more information, visit: https://jsr.io/@dldc/tower");
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
  console.error("Init failed:", error instanceof Error ? error.message : String(error));
  if (error instanceof Error && error.stack) {
    console.error(error.stack);
  }
  Deno.exit(1);
}
