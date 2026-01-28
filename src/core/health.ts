/**
 * Container health check utilities
 *
 * Get the health status of a Docker container.
 * Used by the /status endpoint to report service health.
 */

import { exec } from "../utils/exec.ts";
import { logger } from "../utils/logger.ts";

export interface ContainerHealth {
  name: string;
  status: string;
  health?: "healthy" | "unhealthy" | "starting" | "none";
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
      logger.error(
        `Failed to inspect container ${containerName}: ${
          result.stderr || result.stdout || "unknown error"
        }`,
      );
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
