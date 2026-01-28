/**
 * DNS validation utilities
 *
 * Validate DNS propagation before deploying new domains.
 */

import { DnsError } from "../utils/errors.ts";

/**
 * Validate DNS propagation for domains
 */
export async function validateDns(domains: string[], timeoutSeconds: number = 30): Promise<void> {
  if (domains.length === 0) {
    return;
  }

  console.log(`Validating DNS for ${domains.length} domains...`);

  const results = await Promise.all(
    domains.map((domain) => validateSingleDomain(domain, timeoutSeconds)),
  );

  const failed = results.filter((r) => !r.success);
  if (failed.length > 0) {
    const domainList = failed.map((r) => r.domain).join(", ");
    throw new DnsError(`DNS validation failed for: ${domainList}`);
  }

  console.log("✓ DNS validation passed");
}

/**
 * Validate a single domain
 */
async function validateSingleDomain(
  domain: string,
  timeoutSeconds: number,
): Promise<{ domain: string; success: boolean }> {
  console.log(`Checking DNS for ${domain}...`);

  try {
    // Simple DNS resolution check using Deno.resolveDns
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutSeconds * 1000) {
      try {
        const addresses = await Deno.resolveDns(domain, "A");

        if (addresses.length > 0) {
          console.log(`${domain} resolves to: ${addresses.join(", ")}`);
          return { domain, success: true };
        }
      } catch {
        // Resolution failed, retry
      }

      // Wait before retry
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    console.log(`DNS timeout for ${domain}`);
    return { domain, success: false };
  } catch (error) {
    console.error(`DNS check failed for ${domain}:`, error);
    return { domain, success: false };
  }
}

// Note: We intentionally validate all domains on every run for simplicity.
