/**
 * Apply orchestration logic
 *
 * Coordinates the full deployment flow from intent to running services.
 */

import { DEFAULT_DATA_DIR } from "../config.ts";
import { generateCaddyJson } from "../generators/caddy.ts";
import { generateCompose } from "../generators/compose.ts";
import type { Intent } from "../types.ts";
import { caddyReload, composeUpWithWait, validateCompose } from "../utils/exec.ts";
import { writeTextFile } from "../utils/fs.ts";
import { validateDns } from "./dns.ts";
import { collectDomains, resolveServices } from "./services.ts";
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
  console.log("🚀 Starting deployment");

  // Step 1: Validate intent
  const validatedIntent = validateIntent(intent);
  console.log("✓ Intent validated");

  const dataDir = validatedIntent.dataDir ?? DEFAULT_DATA_DIR;

  // Step 2: Resolve services (includes image resolution)
  const services = await resolveServices(validatedIntent);
  console.log(`✓ Resolved ${services.length} service(s)`);

  // Step 3: Validate DNS for all domains (naive parallel check)
  const domains = collectDomains(services);
  await validateDns(domains);

  // Step 4: Generate docker-compose.yml and Caddy.json
  const composeYaml = generateCompose(services);
  const composePath = `${dataDir}/docker-compose.yml`;

  const caddyJson = generateCaddyJson(services, validatedIntent.adminEmail);
  const caddyPath = `${dataDir}/Caddy.json`;

  // Step 5: Validate generated configs (before writing to disk)
  // Write to temp file for validation
  const tempComposePath = `${dataDir}/.docker-compose.yml.tmp`;
  await writeTextFile(tempComposePath, composeYaml);

  try {
    await validateCompose(tempComposePath);
    console.log("✓ docker-compose.yml validated");

    // Validation passed, write final file
    await writeTextFile(composePath, composeYaml);
    console.log(`✓ Wrote docker-compose.yml to ${dataDir}`);

    // Clean up temp file
    await Deno.remove(tempComposePath).catch(() => {});
  } catch (error) {
    await Deno.remove(tempComposePath).catch(() => {});
    throw new Error(`docker-compose.yml validation failed`, { cause: error });
  }

  await writeTextFile(caddyPath, caddyJson);
  console.log(`✓ Wrote Caddy.json to ${dataDir}`);

  // Step 6: Apply via docker compose up (with health check waiting)
  await composeUpWithWait(composePath);
  console.log("✓ Applied docker-compose.yml and waited for health checks");

  // Step 7: Reload Caddy (validate and load config via admin API)
  await writeTextFile(caddyPath, caddyJson);
  console.log(`Wrote Caddy config to ${caddyPath}`);

  // Reload Caddy in the container
  await caddyReload(composePath);
  console.log("✓ Caddy config reloaded via docker compose exec");
  console.log("✓ Reloaded Caddy via admin API");

  // Step 8: Save applied intent with resolved images
  await writeTextFile(`${dataDir}/intent.json`, JSON.stringify(intent, null, 2));
  console.log("✓ Saved applied intent");

  const appCount = intent.apps.length;
  console.log(`✅ Deployment complete: ${appCount} app(s) running`);
}
