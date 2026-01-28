/**
 * Command execution utilities
 *
 * Run docker, docker compose, and caddy commands with proper error handling.
 */

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
  console.log(`Executing: ${cmd.join(" ")}`);

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
    console.log(`Command failed with code ${code}`);
    console.log(`stderr: ${stderrText}`);
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
    const error = new Error(`Stderr: ${result.stderr}`);
    throw new Error(
      `Command failed: ${cmd.join(" ")} (exit code: ${result.code})`,
      { cause: error },
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
 * Run docker compose up -d --wait with streaming output
 * Blocks until all services are healthy
 */
export async function composeUpWithWait(composeFile: string): Promise<void> {
  const command = new Deno.Command("docker", {
    args: ["compose", "-f", composeFile, "up", "-d", "--wait"],
    stdout: "inherit",
    stderr: "inherit",
  });

  const result = await command.output();
  if (result.code !== 0) {
    throw new Error(`docker compose up --wait failed with code ${result.code}`);
  }
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
 * Validate docker-compose.yml syntax (alias for composeConfig)
 */
export async function validateCompose(composeFile: string): Promise<void> {
  await composeConfig(composeFile);
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
export function caddyValidate(caddyfile: string): void {
  // Note: Validation happens in container
  // We could copy file to temp location and validate, or use docker exec
  // TODO: Implement proper validation
  console.log(`Validating Caddyfile: ${caddyfile}`);
}
