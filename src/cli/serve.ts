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

  console.log(`🗼 Tower HTTP Server`);
  console.log(`Port: ${port}`);
  console.log(`Data directory: ${dataDir}`);
  console.log("");

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
      console.error("Request error:", error);

      return new Response(
        `Internal Server Error: ${error instanceof Error ? error.message : String(error)}`,
        { status: 500 },
      );
    }
  };

  console.log(`Listening on http://localhost:${port}`);
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
    console.error("Invalid intent:", error);
    return new Response(
      `Invalid intent: ${error instanceof Error ? error.message : String(error)}`,
      { status: 400 },
    );
  }

  // Create streaming response
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const writeLog = (line: string) => {
        console.log(line);
        controller.enqueue(encoder.encode(line + "\n"));
      };

      try {
        writeLog("🚀 Starting deployment...");
        writeLog("");

        await apply(intent);

        writeLog("");
        writeLog("✓ Deployment successful");
      } catch (error) {
        writeLog("");
        writeLog(
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
    console.error("Invalid intent on disk:", error);
    return new Response(
      `Invalid intent.json: ${error instanceof Error ? error.message : String(error)}`,
      { status: 500 },
    );
  }

  // Create streaming response
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const writeLog = (line: string) => {
        console.log(line);
        controller.enqueue(encoder.encode(line + "\n"));
      };

      try {
        writeLog("🔄 Refreshing deployment...");
        writeLog("Re-resolving semver ranges...");
        writeLog("");

        // Apply will re-resolve semver and only update if digests changed
        await apply(intent);

        writeLog("");
        writeLog("✓ Refresh complete");
      } catch (error) {
        writeLog("");
        writeLog(
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
  console.error("Serve failed:", error);
  Deno.exit(1);
}
