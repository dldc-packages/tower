/**
 * Container health check utilities
 *
 * Wait for Docker containers to report healthy status.
 */

import { HealthCheckError } from "../utils/errors.ts";
import { exec } from "../utils/exec.ts";
import { logger } from "../utils/logger.ts";

export interface ContainerHealth {
  name: string;
  status: string;
  health?: "healthy" | "unhealthy" | "starting" | "none";
}

/**
 * Wait for containers to become healthy
 */
export async function waitForHealthy(
  containerNames: string[],
  timeoutSeconds: number = 60,
): Promise<void> {
  logger.info(`Waiting for ${containerNames.length} containers to be healthy...`);

  const startTime = Date.now();
  const timeoutMs = timeoutSeconds * 1000;

  while (true) {
    const elapsed = Date.now() - startTime;

    if (elapsed > timeoutMs) {
      throw new HealthCheckError(`Health check timeout after ${timeoutSeconds}s`);
    }

    // Check health of all containers
    const health = await Promise.all(
      containerNames.map((name) => getContainerHealth(name)),
    );

    // Log current status
    for (const container of health) {
      logger.info(
        `  ${container.name}: ${container.status} (health: ${container.health ?? "none"})`,
      );
    }

    // Check if all are healthy
    const allHealthy = health.every((c) =>
      c.status === "running" && (c.health === "healthy" || c.health === "none")
    );

    if (allHealthy) {
      logger.info("✓ All containers healthy");
      return;
    }

    // Check for failed containers
    const failed = health.filter((c) => c.health === "unhealthy" || c.status === "exited");
    if (failed.length > 0) {
      const names = failed.map((c) => c.name).join(", ");
      logger.error(`Failed containers details:`);
      for (const container of failed) {
        logger.error(`  ${container.name}: status=${container.status}, health=${container.health}`);
      }
      throw new HealthCheckError(`Containers failed health checks: ${names}`);
    }

    // Wait before next check
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

/**
 * Get health status of a single container
 */
export async function getContainerHealth(containerName: string): Promise<ContainerHealth> {
  try {
    const result = await exec([
      "docker",
      "inspect",
      "--format",
      "{{.State.Status}}|{{.State.Health.Status}}",
      containerName,
    ]);

    if (!result.success) {
      return {
        name: containerName,
        status: "unknown",
        health: "none",
      };
    }

    const [status, healthStatus] = result.stdout.trim().split("|");
    const health = healthStatus === "" ? "none" : healthStatus as ContainerHealth["health"];

    return {
      name: containerName,
      status,
      health,
    };
  } catch (error) {
    logger.error(`Failed to get health for ${containerName}:`, error);
    return {
      name: containerName,
      status: "unknown",
      health: "none",
    };
  }
}
