/**
 * DNS validation utilities
 *
 * Validate DNS propagation before deploying new domains.
 */

import { DnsError } from "../utils/errors.ts";
import { logger } from "../utils/logger.ts";

/**
 * Validate DNS propagation for domains
 */
export async function validateDns(domains: string[], timeoutSeconds: number = 30): Promise<void> {
  if (domains.length === 0) {
    return;
  }

  logger.info(`Validating DNS for ${domains.length} domains...`);

  const results = await Promise.all(
    domains.map((domain) => validateSingleDomain(domain, timeoutSeconds)),
  );

  const failed = results.filter((r) => !r.success);
  if (failed.length > 0) {
    const domainList = failed.map((r) => r.domain).join(", ");
    throw new DnsError(`DNS validation failed for: ${domainList}`);
  }

  logger.info("✓ DNS validation passed");
}

/**
 * Validate a single domain
 */
async function validateSingleDomain(
  domain: string,
  timeoutSeconds: number,
): Promise<{ domain: string; success: boolean }> {
  logger.debug(`Checking DNS for ${domain}...`);

  try {
    // Simple DNS resolution check using Deno.resolveDns
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutSeconds * 1000) {
      try {
        const addresses = await Deno.resolveDns(domain, "A");

        if (addresses.length > 0) {
          logger.debug(`${domain} resolves to: ${addresses.join(", ")}`);
          return { domain, success: true };
        }
      } catch {
        // Resolution failed, retry
      }

      // Wait before retry
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    logger.warn(`DNS timeout for ${domain}`);
    return { domain, success: false };
  } catch (error) {
    logger.error(`DNS check failed for ${domain}:`, error);
    return { domain, success: false };
  }
}

/**
 * Extract new domains by comparing current and new intents
 */
export function getNewDomains(
  currentDomains: string[],
  newDomains: string[],
): string[] {
  const currentSet = new Set(currentDomains);
  return newDomains.filter((domain) => !currentSet.has(domain));
}
