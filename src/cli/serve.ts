#!/usr/bin/env -S deno run --allow-all

/**
 * Tower HTTP server
 *
 * Runs inside the Tower container and exposes /apply, /refresh, /status endpoints.
 */

import { verify } from "@felix/bcrypt";
import { parseArgs } from "@std/cli/parse-args";
import { DEFAULT_DATA_DIR, DEFAULT_PORT } from "../config.ts";
import { apply } from "../core/applier.ts";
import { getContainerHealth } from "../core/health.ts";
import { validateIntent } from "../core/validator.ts";
import type { AppliedIntent, Credentials, DeploymentStatus, Intent } from "../types.ts";
import { AuthError } from "../utils/errors.ts";
import { fileExists, readJsonFile } from "../utils/fs.ts";
import { parseBasicAuth } from "../utils/http.ts";
import { createConsoleSink, createLogger, createStreamSink, logger } from "../utils/logger.ts";

export interface ServeOptions {
  port?: number;
  dataDir?: string;
}

/**
 * Start Tower HTTP server
 */
export async function runServe(options: ServeOptions = {}): Promise<void> {
  const port = options.port ?? parseInt(Deno.env.get("TOWER_PORT") ?? String(DEFAULT_PORT), 10);
  const dataDir = options.dataDir ?? Deno.env.get("TOWER_DATA_DIR") ?? DEFAULT_DATA_DIR;

  logger.info(`🗼 Tower HTTP Server`);
  logger.info(`Port: ${port}`);
  logger.info(`Data directory: ${dataDir}`);
  logger.info("");

  const handler = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const path = url.pathname;

    try {
      // Route requests
      if (path === "/apply" && req.method === "POST") {
        return await handleApply(req, dataDir);
      } else if (path === "/refresh" && req.method === "POST") {
        return await handleRefresh(req, dataDir);
      } else if (path === "/status" && req.method === "GET") {
        return await handleStatus(req, dataDir);
      } else {
        return new Response("Not Found", { status: 404 });
      }
    } catch (error) {
      logger.error("Request error:", error);

      if (error instanceof AuthError) {
        return new Response("Unauthorized", {
          status: 401,
          headers: { "WWW-Authenticate": 'Basic realm="Tower"' },
        });
      }

      return new Response(
        `Internal Server Error: ${error instanceof Error ? error.message : String(error)}`,
        { status: 500 },
      );
    }
  };

  logger.info(`Listening on http://localhost:${port}`);
  await Deno.serve({ port }, handler).finished;
}

/**
 * Authenticate request using Basic Auth
 */
async function authenticate(req: Request, dataDir: string): Promise<void> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    throw new AuthError("Missing Authorization header");
  }

  const credentials = parseBasicAuth(authHeader);
  if (!credentials) {
    throw new AuthError("Invalid Authorization header");
  }

  // Load credentials from disk
  const credsPath = `${dataDir}/credentials.json`;
  if (!await fileExists(credsPath)) {
    throw new AuthError("Credentials file not found");
  }

  const creds = await readJsonFile<Credentials>(credsPath);

  // Validate tower credentials
  if (credentials.username !== creds.tower.username) {
    throw new AuthError("Invalid username");
  }

  const valid = await verify(credentials.password, creds.tower.password_hash);
  if (!valid) {
    throw new AuthError("Invalid password");
  }
}

/**
 * Handle POST /apply endpoint
 */
async function handleApply(req: Request, dataDir: string): Promise<Response> {
  // Authenticate
  await authenticate(req, dataDir);

  // Parse intent from body
  const body = await req.text();
  let intent: Intent;

  try {
    const data = JSON.parse(body);
    intent = validateIntent(data);
  } catch (error) {
    logger.error("Invalid intent:", error);
    return new Response(
      `Invalid intent: ${error instanceof Error ? error.message : String(error)}`,
      { status: 400 },
    );
  }

  // Create streaming response
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const streamSink = createStreamSink(
        (line) => controller.enqueue(encoder.encode(line + "\n")),
      );
      const streamLogger = createLogger({
        sinks: [createConsoleSink(), streamSink],
      });

      try {
        streamLogger.info("🚀 Starting deployment...");
        streamLogger.info("");

        await apply(intent);

        streamLogger.info("");
        streamLogger.info("✓ Deployment successful");
      } catch (error) {
        streamLogger.info("");
        streamLogger.error(
          `❌ Deployment failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Transfer-Encoding": "chunked",
    },
  });
}

/**
 * Handle POST /refresh endpoint
 */
async function handleRefresh(req: Request, dataDir: string): Promise<Response> {
  // Authenticate
  await authenticate(req, dataDir);

  // Load current intent from disk
  const intentPath = `${dataDir}/intent.json`;
  if (!await fileExists(intentPath)) {
    return new Response("No intent.json found", { status: 404 });
  }

  let intent: Intent;
  try {
    const data = await readJsonFile(intentPath);
    intent = validateIntent(data);
  } catch (error) {
    logger.error("Invalid intent on disk:", error);
    return new Response(
      `Invalid intent.json: ${error instanceof Error ? error.message : String(error)}`,
      { status: 500 },
    );
  }

  // Create streaming response
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const streamSink = createStreamSink(
        (line) => controller.enqueue(encoder.encode(line + "\n")),
      );
      const streamLogger = createLogger({
        sinks: [createConsoleSink(), streamSink],
      });

      try {
        streamLogger.info("🔄 Refreshing deployment...");
        streamLogger.info("Re-resolving semver ranges...");
        streamLogger.info("");

        // Apply will re-resolve semver and only update if digests changed
        await apply(intent);

        streamLogger.info("");
        streamLogger.info("✓ Refresh complete");
      } catch (error) {
        streamLogger.info("");
        streamLogger.error(
          `❌ Refresh failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Transfer-Encoding": "chunked",
    },
  });
}

/**
 * Handle GET /status endpoint
 */
async function handleStatus(req: Request, dataDir: string): Promise<Response> {
  // Authenticate
  await authenticate(req, dataDir);

  try {
    // Load applied intent
    const appliedPath = `${dataDir}/intent.json`;
    let appliedIntent: AppliedIntent | undefined;

    if (await fileExists(appliedPath)) {
      appliedIntent = await readJsonFile<AppliedIntent>(appliedPath);
    }

    // Get service statuses
    const serviceNames = [
      "caddy",
      "tower",
      "registry",
      "otel-lgtm",
      ...(appliedIntent?.apps.map((app) => app.name) ?? []),
    ];

    const services = await Promise.all(
      serviceNames.map(async (name) => {
        const health = await getContainerHealth(name);
        return {
          name,
          state: health.status as "running" | "starting" | "unhealthy" | "stopped",
          health: health.health === "none" ? undefined : health.health,
        };
      }),
    );

    // Build status response
    const status: DeploymentStatus = {
      appliedIntent,
      services,
      domains: appliedIntent
        ? [
          {
            domain: appliedIntent.tower.domain,
            target: "tower:3100",
            tlsEnabled: true,
          },
          {
            domain: appliedIntent.registry.domain,
            target: "registry:5000",
            tlsEnabled: true,
          },
          {
            domain: appliedIntent.otel.domain,
            target: "otel-lgtm:3000",
            tlsEnabled: true,
          },
          ...appliedIntent.apps.map((app) => ({
            domain: app.domain,
            target: `${app.name}:${app.port ?? 3000}`,
            tlsEnabled: true,
          })),
        ]
        : [],
    };

    // Format as plain text
    const lines: string[] = ["Tower Status", "=".repeat(60), ""];

    if (appliedIntent) {
      lines.push(`Applied: ${appliedIntent.appliedAt}`);
      lines.push(`Apps: ${appliedIntent.apps.length}`);
      lines.push("");
    } else {
      lines.push("No deployment applied yet");
      lines.push("");
    }

    lines.push("Services:");
    for (const service of status.services) {
      const healthStr = service.health ? ` (${service.health})` : "";
      lines.push(`  ${service.name}: ${service.state}${healthStr}`);
    }
    lines.push("");

    if (status.domains.length > 0) {
      lines.push("Domains:");
      for (const domain of status.domains) {
        const tls = domain.tlsEnabled ? "🔒" : "  ";
        lines.push(`  ${tls} ${domain.domain} → ${domain.target}`);
      }
    }

    return new Response(lines.join("\n"), {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (error) {
    logger.error("Status error:", error);
    return new Response(
      `Failed to get status: ${error instanceof Error ? error.message : String(error)}`,
      { status: 500 },
    );
  }
}

if (!import.meta.main) throw new Error("This module must be run as the main module");

const args = parseArgs(Deno.args, {
  string: ["port", "data-dir"],
  boolean: ["help"],
  alias: {
    h: "help",
    p: "port",
    d: "data-dir",
  },
});

if (args.help) {
  console.log(`
Tower Serve - Start Tower HTTP server

USAGE:
  serve [options]

OPTIONS:
  -p, --port         Server port (default: 3100)
  -d, --data-dir     Data directory (default: /var/infra)
  -h, --help         Show this help message

EXAMPLE:
  docker run -p 3100:3100 ghcr.io/dldc-packages/tower:latest
`);
  Deno.exit(0);
}

try {
  const port = args.port ? parseInt(args.port, 10) : undefined;
  const dataDir = args["data-dir"] as string | undefined;
  await runServe({ port, dataDir });
} catch (error) {
  logger.error("Serve failed:", error);
  Deno.exit(1);
}
