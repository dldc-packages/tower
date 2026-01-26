/**
 * Tower initialization command
 *
 * Performs one-time bootstrap of Tower infrastructure.
 */

import { hash } from "@felix/bcrypt";
import { input } from "@inquirer/prompts";
import denoJson from "../../deno.json" with { type: "json" };
import { DEFAULT_DATA_DIR } from "../config.ts";
import { waitForHealthy } from "../core/health.ts";
import type { Credentials, Intent } from "../types.ts";
import {
  checkDocker,
  checkDockerCompose,
  composeConfig,
  composeUp,
  execOrThrow,
} from "../utils/exec.ts";
import { ensureDir, fileExists, writeJsonFile, writeTextFile } from "../utils/fs.ts";
import { logger } from "../utils/logger.ts";

export interface InitOptions {
  dataDir?: string;
}

/**
 * Run Tower initialization flow
 *
 * Steps:
 * 1. Check prerequisites (Docker, Compose)
 * 2. Prompt for configuration
 * 3. Generate initial intent.json and credentials
 * 4. Bootstrap the stack (apply initial config)
 * 5. Print summary and credentials
 */
export async function runInit(options: InitOptions = {}): Promise<void> {
  const dataDir = options.dataDir ?? DEFAULT_DATA_DIR;

  logger.info("🗼 Tower Initialization");
  logger.info("");

  // Step 1: Check prerequisites
  await checkPrerequisites();

  // Step 2: Prompt for configuration
  logger.info("");
  const config = await promptConfiguration();

  // Step 3: Generate credentials
  logger.info("");
  const credentials = await generateCredentials(dataDir);

  // Step 4: Generate initial intent
  logger.info("");
  const intent = generateInitialIntent(config, dataDir);
  logger.info("✓ Initial intent generated");

  // Step 5: Bootstrap tower-only compose and call /apply inside the container
  logger.info("");
  await bootstrapAndApply(intent, dataDir);

  // Step 6: Wait for services to be healthy
  logger.info("");
  logger.info("Waiting for services to start...");
  await waitForHealthy(["tower", "caddy", "registry", "grafana", "loki", "tempo"], 120);

  // Step 7: Print final summary
  logger.info("");
  printSummary(config, credentials, intent);
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
 * Prompt user for Tower configuration
 */
async function promptConfiguration(): Promise<{
  adminEmail: string;
  towerDomain: string;
  registryDomain: string;
  otelDomain: string;
}> {
  logger.info("Collecting configuration...");
  logger.info("");

  // Prompt for admin email
  const adminEmail = await input({
    message: "Admin email (for Let's Encrypt ACME notifications):",
    validate: (value) => {
      if (!value.includes("@") || !value.includes(".")) {
        return "Please enter a valid email address";
      }
      return true;
    },
  });

  // Prompt for Tower domain
  const towerDomain = await input({
    message: "Tower domain (e.g., tower.example.com):",
    validate: (value) => {
      if (!isValidDomain(value)) {
        return "Please enter a valid domain (e.g., tower.example.com)";
      }
      return true;
    },
  });

  // Prompt for Registry domain
  const registryDomain = await input({
    message: "Registry domain (e.g., registry.example.com):",
    validate: (value) => {
      if (!isValidDomain(value)) {
        return "Please enter a valid domain (e.g., registry.example.com)";
      }
      return true;
    },
  });

  // Prompt for OTEL domain
  const otelDomain = await input({
    message: "OTEL/Grafana domain (e.g., otel.example.com):",
    validate: (value) => {
      if (!isValidDomain(value)) {
        return "Please enter a valid domain (e.g., otel.example.com)";
      }
      return true;
    },
  });

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
 * Generate random credentials and hash them
 */
async function generateCredentials(
  dataDir: string,
): Promise<{
  towerPassword: string;
  registryPassword: string;
}> {
  logger.info("Generating credentials...");

  // Create data directory if it doesn't exist
  await ensureDir(dataDir);

  // Generate secure random passwords
  const towerPassword = generateSecurePassword(32);
  const registryPassword = generateSecurePassword(32);

  logger.info("  Hashing passwords...");

  // Hash passwords with bcrypt
  const towerHash = await hash(towerPassword);
  const registryHash = await hash(registryPassword);

  // Create credentials object
  const credentials: Credentials = {
    tower: {
      username: "tower",
      password_hash: towerHash,
    },
    registry: {
      username: "ci",
      password_hash: registryHash,
    },
  };

  // Write credentials to file
  await writeJsonFile(`${dataDir}/credentials.json`, credentials);
  logger.info("  ✓ Credentials generated and saved");

  return {
    towerPassword,
    registryPassword,
  };
}

/**
 * Generate a cryptographically secure random password
 */
function generateSecurePassword(length: number = 32): string {
  const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*-_=+";
  const values = new Uint8Array(length);
  crypto.getRandomValues(values);
  return Array.from(values)
    .map((x) => charset[x % charset.length])
    .join("");
}

/**
 * Generate initial intent.json configuration
 */
function generateInitialIntent(
  config: {
    adminEmail: string;
    towerDomain: string;
    registryDomain: string;
    otelDomain: string;
  },
  dataDir: string,
): Intent {
  const intent: Intent = {
    version: "1",
    adminEmail: config.adminEmail,
    tower: {
      version: denoJson.version,
      domain: config.towerDomain,
    },
    registry: {
      domain: config.registryDomain,
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
 * Apply the initial Tower stack
 */
async function bootstrapAndApply(intent: Intent, dataDir: string): Promise<void> {
  logger.info("Bootstrapping tower-only compose...");

  const composePath = `${dataDir}/docker-compose.bootstrap.yml`;
  const composeContent = buildBootstrapCompose(dataDir);
  await writeTextFile(composePath, composeContent);

  await composeConfig(composePath);
  await composeUp(composePath);

  await waitForHealthy(["tower"], 60);

  logger.info("Calling tower /apply via docker network (no host port exposure)...");
  await callTowerApply(intent, dataDir);
}

function buildBootstrapCompose(dataDir: string): string {
  return `version: "3.8"

services:
  tower:
    image: dldc/tower:${denoJson.version}
    environment:
      - TOWER_DATA_DIR=${dataDir}
    volumes:
      - ${dataDir}:/var/infra
      - /var/run/docker.sock:/var/run/docker.sock
    container_name: tower
    networks:
      - tower_bootstrap
    restart: unless-stopped

networks:
  tower_bootstrap:
    name: tower_bootstrap
`;
}

async function callTowerApply(intent: Intent, dataDir: string): Promise<void> {
  const tempIntentPath = `${dataDir}/.intent.bootstrap.json`;
  await writeTextFile(tempIntentPath, JSON.stringify(intent));

  const cmd = [
    "docker",
    "run",
    "--rm",
    "--network",
    "tower_bootstrap",
    "-v",
    `${tempIntentPath}:/intent.json:ro`,
    "curlimages/curl:8.1.2",
    "-sS",
    "-X",
    "POST",
    "-H",
    "Content-Type: application/json",
    "--data-binary",
    "@/intent.json",
    "http://tower:3100/apply",
  ];

  await execOrThrow(cmd);
  logger.info("✓ /apply completed");
}

/**
 * Print initialization summary
 */
function printSummary(
  config: {
    adminEmail: string;
    towerDomain: string;
    registryDomain: string;
    otelDomain: string;
  },
  credentials: {
    towerPassword: string;
    registryPassword: string;
  },
  intent: Intent,
): void {
  logger.info("✓ Initialization complete!");
  logger.info("");
  logger.info("Configuration:");
  logger.info(`  Admin email: ${config.adminEmail}`);
  logger.info(`  Tower domain: ${config.towerDomain}`);
  logger.info(`  Registry domain: ${config.registryDomain}`);
  logger.info(`  OTEL domain: ${config.otelDomain}`);
  logger.info("");
  logger.info("Intent:");
  logger.info(JSON.stringify(intent, null, 2));
  logger.info("");
  logger.info("⚠️  IMPORTANT: Save these credentials securely!");
  logger.info("");
  logger.info("Tower API credentials (for deployments):");
  logger.info(`  Username: tower`);
  logger.info(`  Password: ${credentials.towerPassword}`);
  logger.info("");
  logger.info("Registry credentials (for CI/CD image push):");
  logger.info(`  Username: ci`);
  logger.info(`  Password: ${credentials.registryPassword}`);
  logger.info("");
  logger.info("Next steps:");
  logger.info("  1. Configure DNS records to point to this server:");
  logger.info(`     - ${config.towerDomain} → this server's IP`);
  logger.info(`     - ${config.registryDomain} → this server's IP`);
  logger.info(`     - ${config.otelDomain} → this server's IP`);
  logger.info("  2. Wait for Let's Encrypt SSL certificates to be issued (may take a few minutes)");
  logger.info("  3. Access Tower API at https://" + config.towerDomain);
  logger.info("  4. Access Grafana at https://" + config.otelDomain);
  logger.info("");
  logger.info("For more information, visit: https://jsr.io/@dldc/tower");
}
