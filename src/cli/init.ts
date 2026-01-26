/**
 * Tower initialization command
 *
 * Performs one-time bootstrap of Tower infrastructure.
 */

import { input } from "@inquirer/prompts";
import { checkDocker, checkDockerCompose } from "../utils/exec.ts";
import { fileExists } from "../utils/fs.ts";
import { logger } from "../utils/logger.ts";

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
export async function runInit(): Promise<void> {
  logger.info("🗼 Tower Initialization");
  logger.info("");

  // Step 1: Check prerequisites
  await checkPrerequisites();

  // Step 2: Prompt for configuration
  logger.info("");
  const config = await promptConfiguration();

  // TODO: Implement remaining steps
  // 3. generateCredentials()
  // 4. generateInitialIntent()
  // 5. applyInitialStack()
  // 6. waitForHealthy()
  // 7. printSummary()

  logger.info("");
  logger.info("✓ Configuration collected!");
  logger.info(`  Admin email: ${config.adminEmail}`);
  logger.info(`  Tower domain: ${config.towerDomain}`);
  logger.info(`  Registry domain: ${config.registryDomain}`);
  logger.info(`  OTEL domain: ${config.otelDomain}`);
  logger.warn("Remaining initialization steps not yet implemented");
  logger.info("See BLUEPRINT.md for implementation details");
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
function _generateCredentials(): {
  towerPassword: string;
  registryPassword: string;
} {
  // TODO: Generate secure random passwords
  // TODO: Hash with bcrypt
  // TODO: Write to /var/infra/credentials.json
  throw new Error("Not implemented");
}
