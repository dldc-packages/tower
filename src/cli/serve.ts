/**
 * Tower HTTP server
 *
 * Runs inside the Tower container and exposes /apply, /refresh, /status endpoints.
 */

import { logger } from "../utils/logger.ts";

export interface ServeOptions {
  port?: number;
  dataDir?: string;
}

/**
 * Start Tower HTTP server
 */
export async function runServe(options: ServeOptions = {}): Promise<void> {
  const port = options.port ?? parseInt(Deno.env.get("TOWER_PORT") ?? "3100", 10);
  const dataDir = options.dataDir ?? Deno.env.get("TOWER_DATA_DIR") ?? "/var/infra";

  logger.info(`🗼 Tower HTTP Server`);
  logger.info(`Port: ${port}`);
  logger.info(`Data directory: ${dataDir}`);
  logger.info("");

  // TODO: Implement HTTP server with endpoints:
  // - POST /apply
  // - POST /refresh
  // - GET /status

  logger.warn("HTTP server not yet implemented");
  logger.info("See BLUEPRINT.md for API specification");

  // Placeholder server
  const handler = (req: Request): Response => {
    const url = new URL(req.url);
    return new Response(`Tower server placeholder\nPath: ${url.pathname}`, {
      status: 501,
      headers: { "Content-Type": "text/plain" },
    });
  };

  logger.info(`Listening on http://localhost:${port}`);
  await Deno.serve({ port }, handler).finished;
}

/**
 * Handle POST /apply endpoint
 */
function _handleApply(_req: Request): Response {
  // TODO:
  // 1. Authenticate (Basic Auth)
  // 2. Parse intent from body
  // 3. Call applier.apply(intent)
  // 4. Stream logs back to client
  // 5. Return success/failure status
  throw new Error("Not implemented");
}

/**
 * Handle POST /refresh endpoint
 */
function _handleRefresh(_req: Request): Response {
  // TODO:
  // 1. Authenticate
  // 2. Load current intent from disk
  // 3. Re-resolve semver (check for updates)
  // 4. Apply if digests changed
  // 5. Stream logs and return status
  throw new Error("Not implemented");
}

/**
 * Handle GET /status endpoint
 */
function _handleStatus(_req: Request): Response {
  // TODO:
  // 1. Authenticate
  // 2. Load applied-intent.json
  // 3. Query Docker for service status
  // 4. Return formatted status
  throw new Error("Not implemented");
}
