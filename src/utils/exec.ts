/**
 * Command execution utilities
 *
 * Run docker, docker compose, and caddy commands with proper error handling.
 */

import { logger } from "./logger.ts";

export interface ExecResult {
  success: boolean;
  stdout: string;
  stderr: string;
  code: number;
}

/**
 * Execute a shell command and return result
 */
export async function exec(cmd: string[]): Promise<ExecResult> {
  logger.debug(`Executing: ${cmd.join(" ")}`);

  const command = new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    stdout: "piped",
    stderr: "piped",
  });

  const process = command.spawn();
  const { code, stdout, stderr } = await process.output();

  const decoder = new TextDecoder();
  const stdoutText = decoder.decode(stdout);
  const stderrText = decoder.decode(stderr);

  if (code !== 0) {
    logger.debug(`Command failed with code ${code}`);
    logger.debug(`stderr: ${stderrText}`);
  }

  return {
    success: code === 0,
    stdout: stdoutText,
    stderr: stderrText,
    code,
  };
}

/**
 * Execute a command and throw if it fails
 */
export async function execOrThrow(cmd: string[]): Promise<string> {
  const result = await exec(cmd);
  if (!result.success) {
    throw new Error(
      `Command failed: ${cmd.join(" ")}\nCode: ${result.code}\nStderr: ${result.stderr}`,
    );
  }
  return result.stdout;
}

/**
 * Check if Docker is available
 */
export async function checkDocker(): Promise<boolean> {
  try {
    const result = await exec(["docker", "--version"]);
    return result.success;
  } catch {
    return false;
  }
}

/**
 * Check if Docker Compose is available
 */
export async function checkDockerCompose(): Promise<boolean> {
  try {
    const result = await exec(["docker", "compose", "version"]);
    return result.success;
  } catch {
    return false;
  }
}

/**
 * Run docker compose up -d
 */
export async function composeUp(composeFile: string): Promise<void> {
  await execOrThrow(["docker", "compose", "-f", composeFile, "up", "-d"]);
}

/**
 * Run docker compose down
 */
export async function composeDown(composeFile: string): Promise<void> {
  await execOrThrow(["docker", "compose", "-f", composeFile, "down"]);
}

/**
 * Validate docker-compose.yml syntax
 */
export async function composeConfig(composeFile: string): Promise<void> {
  await execOrThrow(["docker", "compose", "-f", composeFile, "config", "-q"]);
}

/**
 * Reload Caddy configuration
 */
export async function caddyReload(): Promise<void> {
  await execOrThrow([
    "docker",
    "exec",
    "caddy",
    "caddy",
    "reload",
    "--config",
    "/etc/caddy/Caddyfile",
  ]);
}

/**
 * Validate Caddyfile syntax
 */
export async function caddyValidate(caddyfile: string): Promise<void> {
  // Note: Validation happens in container
  // We could copy file to temp location and validate, or use docker exec
  // TODO: Implement proper validation
  logger.debug(`Validating Caddyfile: ${caddyfile}`);
}
