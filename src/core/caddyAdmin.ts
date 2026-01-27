/**
 * Caddy admin API client
 */

import { request } from "../utils/http.ts";
import { logger } from "../utils/logger.ts";

const DEFAULT_ADMIN_ORIGIN = "http://localhost:2019";

/**
 * Load a Caddy config via the admin API. Caddy validates the payload before
 * applying it; on failure it keeps the current config and returns an error.
 */
export async function loadCaddyConfig(
  configJson: string,
  adminOrigin = DEFAULT_ADMIN_ORIGIN,
): Promise<void> {
  const origin = adminOrigin.replace(/\/$/, "");
  const url = `${origin}/load`;

  logger.info(`Pushing Caddy config via admin API: ${url}`);

  const response = await request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: configJson,
    timeout: 15000,
  });

  if (!response.ok) {
    const body = await response.text();
    const error = new Error(body);
    throw new Error(`Caddy load failed (${response.status})`, { cause: error });
  }

  logger.info("✓ Caddy config accepted by admin API");
}
