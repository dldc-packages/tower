/**
 * Apply orchestration logic
 *
 * Coordinates the full deployment flow from intent to running services.
 */

import type { Intent } from "@dldc/tower/types";
import { DEFAULT_DATA_DIR } from "../config.ts";
import { generateCaddyJson } from "../generators/caddy.ts";
import { generateCompose } from "../generators/compose.ts";
import { composeUpWithWait, validateCompose } from "../utils/exec.ts";
import { writeTextFile } from "../utils/fs.ts";
import { logger } from "../utils/logger.ts";
import { loadCaddyConfig } from "./caddyAdmin.ts";
import { collectDomains, resolveSemver, resolveServices } from "./deployer.ts";
import { validateDns } from "./dns.ts";
import { validateIntent } from "./validator.ts";

/** * Apply deployment intent
 *
 * Steps:
 * 1. Validate intent
 * 2. Resolve services (infra + apps)
 * 3. Resolve semver ranges to digests
 * 4. Validate DNS for new domains
 * 5. Generate docker-compose.yml and Caddy.json
 * 6. Validate generated configs
 * 7. Apply via docker compose up
 * 8. Wait for health checks
 * 9. Reload Caddy
 * 10. Save intent.json
 */
export async function apply(intent: Intent): Promise<void> {
  logger.info("🚀 Starting deployment");

  // Step 1: Validate intent
  const validatedIntent = validateIntent(intent);
  logger.info("✓ Intent validated");

  const dataDir = validatedIntent.dataDir ?? DEFAULT_DATA_DIR;

  // Step 2: Resolve services
  const services = resolveServices(validatedIntent);
  logger.info(`✓ Resolved ${services.length} service(s)`);

  // Step 3: Resolve semver ranges to digests
  const resolvedImages = await resolveSemver(validatedIntent);
  logger.info(`✓ Resolved ${resolvedImages.size} image(s) to digests`);

  // Step 4: Validate DNS for all domains (naive parallel check)
  const domains = collectDomains(services);
  await validateDns(domains);

  // Step 5: Generate docker-compose.yml and Caddy.json
  const composeYaml = generateCompose(validatedIntent, resolvedImages);
  const composePath = `${dataDir}/docker-compose.yml`;

  const caddyJson = generateCaddyJson(services, validatedIntent.adminEmail);
  const caddyPath = `${dataDir}/Caddy.json`;

  // Step 6: Validate generated configs (before writing to disk)
  // Write to temp file for validation
  const tempComposePath = `${dataDir}/.docker-compose.yml.tmp`;
  await writeTextFile(tempComposePath, composeYaml);

  try {
    await validateCompose(tempComposePath);
    logger.info("✓ docker-compose.yml validated");

    // Validation passed, write final file
    await writeTextFile(composePath, composeYaml);
    logger.info(`✓ Wrote docker-compose.yml to ${dataDir}`);

    // Clean up temp file
    await Deno.remove(tempComposePath).catch(() => {});
  } catch (error) {
    await Deno.remove(tempComposePath).catch(() => {});
    throw new Error(`docker-compose.yml validation failed`, { cause: error });
  }

  await writeTextFile(caddyPath, caddyJson);
  logger.info(`✓ Wrote Caddy.json to ${dataDir}`);

  // Step 7: Apply via docker compose up (with health check waiting)
  await composeUpWithWait(composePath);
  logger.info("✓ Applied docker-compose.yml and waited for health checks");

  // Step 8: Reload Caddy (validate and load config via admin API)
  await loadCaddyConfig(caddyJson);
  logger.info("✓ Reloaded Caddy via admin API");

  // Step 9: Save applied intent with resolved images
  const appliedIntent = {
    ...validatedIntent,
    appliedAt: new Date().toISOString(),
    resolvedImages: Object.fromEntries(resolvedImages),
  };
  await writeTextFile(`${dataDir}/intent.json`, JSON.stringify(appliedIntent, null, 2));
  logger.info("✓ Saved applied intent");

  const appCount = services.filter((s) => s.type === "app").length;
  logger.info(`✅ Deployment complete: ${appCount} app(s) running`);
}
