/**
 * Tower initialization command
 *
 * Performs one-time bootstrap of Tower infrastructure.
 */

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

  // TODO: Implement remaining steps
  // 2. promptConfiguration()
  // 3. generateCredentials()
  // 4. generateInitialIntent()
  // 5. applyInitialStack()
  // 6. waitForHealthy()
  // 7. printSummary()

  logger.info("");
  logger.info("✓ Prerequisites check passed!");
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
function _promptConfiguration(): {
  adminEmail: string;
  towerDomain: string;
  registryDomain: string;
  otelDomain: string;
} {
  // TODO: Use @std/cli/prompt or similar
  // TODO: Validate domains (basic format check)
  throw new Error("Not implemented");
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
