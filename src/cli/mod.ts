#!/usr/bin/env -S deno run --allow-all

/**
 * Tower CLI entry point
 *
 * Handles command routing and argument parsing.
 */

import { parseArgs } from "@std/cli/parse-args";

async function main() {
  const args = parseArgs(Deno.args, {
    string: ["port", "data-dir"],
    boolean: ["help", "version"],
    alias: {
      h: "help",
      v: "version",
      p: "port",
      d: "data-dir",
    },
  });

  const command = args._[0] as string | undefined;

  if (args.version) {
    console.log("Tower v0.1.0");
    Deno.exit(0);
  }

  if (args.help || !command) {
    printHelp();
    Deno.exit(0);
  }

  try {
    switch (command) {
      case "init": {
        const { runInit } = await import("./init.ts");
        await runInit();
        break;
      }

      case "serve": {
        const { runServe } = await import("./serve.ts");
        const port = args.port ? parseInt(args.port, 10) : undefined;
        const dataDir = args["data-dir"] as string | undefined;
        await runServe({ port, dataDir });
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        printHelp();
        Deno.exit(1);
    }
  } catch (error) {
    console.error("Error:", error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  }
}

function printHelp() {
  console.log(`
Tower - GitOps deployment orchestration

USAGE:
  tower <command> [options]

COMMANDS:
  init              Bootstrap Tower infrastructure (one-time setup)
  serve             Start Tower HTTP server (runs inside container)

OPTIONS:
  -h, --help        Show this help message
  -v, --version     Show version
  -p, --port        Server port (default: 3100)
  -d, --data-dir    Data directory (default: /var/infra)

EXAMPLES:
  # Bootstrap Tower
  sudo tower init

  # Start HTTP server
  tower serve --port 3100

For more information, visit: https://jsr.io/@dldc/tower
`);
}

if (import.meta.main) {
  main();
}
