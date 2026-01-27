/**
 * Tower apply command
 *
 * Read intent.json from stdin and apply deployment.
 */

import { parseArgs } from "@std/cli/parse-args";
import { apply as applyIntent } from "../core/applier.ts";
import { validateIntent } from "../core/validator.ts";
import { logger } from "../utils/logger.ts";

export interface ApplyOptions {
  dataDir?: string;
}

/**
 * Run apply command (reads intent from stdin)
 */
export async function runApply(options: ApplyOptions = {}): Promise<void> {
  logger.info("🗼 Tower Apply");
  logger.info("");

  try {
    // Read intent from stdin
    logger.info("Reading intent from stdin...");
    const stdinContent = await readStdin();

    if (!stdinContent.trim()) {
      throw new Error("No input provided. Please pipe intent.json to stdin.");
    }

    // Parse and validate
    const data = JSON.parse(stdinContent);
    const intent = validateIntent(data);

    // Override dataDir if provided via CLI
    if (options.dataDir) {
      intent.dataDir = options.dataDir;
    }

    logger.info("✓ Intent parsed and validated");
    logger.info("");

    // Apply deployment
    await applyIntent(intent);
  } catch (error) {
    logger.error("Apply failed:", error);
    throw error;
  }
}

/**
 * Read all data from stdin
 */
async function readStdin(): Promise<string> {
  const chunks: string[] = [];
  const decoder = new TextDecoderStream();
  const reader = Deno.stdin.readable.pipeThrough(decoder).getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return chunks.join("");
}

if (!import.meta.main) throw new Error("This module must be run as the main module");

const args = parseArgs(Deno.args, {
  string: ["data-dir"],
  boolean: ["help"],
  alias: {
    h: "help",
    d: "data-dir",
  },
});

if (args.help) {
  console.log(`
Tower Apply - Apply deployment from intent.json

USAGE:
  cat intent.json | apply [options]

OPTIONS:
  -d, --data-dir     Data directory (default: /var/infra)
  -h, --help         Show this help message

EXAMPLE:
  cat intent.json | docker run --rm -i ghcr.io/dldc-packages/tower:latest src/cli/apply.ts
`);
  Deno.exit(0);
}

try {
  const dataDir = args["data-dir"] as string | undefined;
  await runApply({ dataDir });
} catch (error) {
  logger.error("Apply failed:", error);
  Deno.exit(1);
}
