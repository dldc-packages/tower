/**
 * Tower apply command
 *
 * Read intent from stdin and apply deployment.
 */

import type { Intent } from "@dldc/tower/types";
import { logger } from "../utils/logger.ts";

/**
 * Run apply command - read intent.json from stdin and deploy
 */
export async function runApply(): Promise<void> {
  logger.info("📝 Reading intent from stdin...");

  try {
    // Read entire stdin as JSON
    const intentText = await readStdin();
    const intent = JSON.parse(intentText) as Intent;

    logger.info(`✓ Parsed intent (${intent.apps.length} apps)`);

    // TODO: Call applier.apply(intent)
    logger.warn("Apply logic not yet implemented");
    logger.info("See BLUEPRINT.md for implementation details");
  } catch (error) {
    logger.error("Failed to parse intent:", error);
    throw error;
  }
}

/**
 * Read all data from stdin
 */
async function readStdin(): Promise<string> {
  const chunks: Uint8Array[] = [];

  for await (const chunk of Deno.stdin.readable) {
    chunks.push(chunk);
  }

  const decoder = new TextDecoder();
  return decoder.decode(concatenateUint8Arrays(chunks));
}

/**
 * Concatenate multiple Uint8Arrays into one
 */
function concatenateUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((acc, arr) => acc + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;

  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }

  return result;
}
