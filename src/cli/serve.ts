/**
 * Tower HTTP server
 *
 * Runs inside the Tower container and exposes /apply, /refresh, /status endpoints.
 * Authentication is handled by Caddy (Basic Auth).
 */

import { parseArgs } from "@std/cli/parse-args";
import { DEFAULT_DATA_DIR, DEFAULT_PORT } from "../config.ts";
import { apply } from "../core/applier.ts";
import { validateIntent } from "../core/validator.ts";
import type { Intent } from "../types.ts";
import { fileExists, readJsonFile } from "../utils/fs.ts";
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
 * Handle POST /apply endpoint
 */
async function handleApply(_req: Request, _dataDir: string): Promise<Response> {
  // Parse intent from body
  const body = await _req.text();
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
async function handleRefresh(_req: Request, dataDir: string): Promise<Response> {
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
 *
 * Simple health check endpoint that returns 200 if Tower is running.
 * Does not read files to avoid permission issues with /var/infra.
 */
function handleStatus(_req: Request, _dataDir: string): Response {
  return new Response(JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
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
  -p, --port         Server port (default: 3000)
  -d, --data-dir     Data directory (default: /var/infra)
  -h, --help         Show this help message

EXAMPLE:
  docker run -p 3000:3000 ghcr.io/dldc-packages/tower:latest
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
