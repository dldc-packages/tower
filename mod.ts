#!/usr/bin/env -S deno run --allow-all

/**
 * Tower CLI entry point
 *
 * Handles command routing and argument parsing.
 */

import { parseArgs } from "@std/cli/parse-args";
import denoJson from "./deno.json" with { type: "json" };

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
    console.log(`Tower v${denoJson.version}`);
    Deno.exit(0);
  }

  if (args.help || !command) {
    printHelp();
    Deno.exit(0);
  }

  try {
    switch (command) {
      case "init": {
        const { runInit } = await import("./src/cli/init.ts");
        const dataDir = args["data-dir"] as string | undefined;
        await runInit({ dataDir });
        break;
      }

      case "serve": {
        const { runServe } = await import("./src/cli/serve.ts");
        const port = args.port ? parseInt(args.port, 10) : undefined;
        const dataDir = args["data-dir"] as string | undefined;
        await runServe({ port, dataDir });
        break;
      }

      case "apply": {
        const { runApply } = await import("./src/cli/apply.ts");
        const dataDir = args["data-dir"] as string | undefined;
        await runApply({ dataDir });
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
  apply             Apply deployment from intent.json (reads from stdin)

OPTIONS:
  -h, --help        Show this help message
  -v, --version     Show version
  -p, --port        Server port (default: 3100)
  -d, --data-dir    Data directory (default: /var/infra)

EXAMPLES:
  # Bootstrap Tower (requires environment variables)
  docker run --rm -it \\
    -v /var/run/docker.sock:/var/run/docker.sock \\
    -v /var/infra:/var/infra \\
    -e ADMIN_EMAIL=admin@example.com \\
    -e TOWER_DOMAIN=tower.example.com \\
    -e REGISTRY_DOMAIN=registry.example.com \\
    -e OTEL_DOMAIN=otel.example.com \\
    -e TOWER_PASSWORD=mysecurepassword \\
    -e REGISTRY_PASSWORD=mysecurepassword \\
    ghcr.io/dldc-packages/tower:latest init

  # Apply deployment from intent.json
  cat intent.json | tower apply
  # or
  tower apply < intent.json

  # Start HTTP server
  tower serve --port 3100

For more information, visit: https://jsr.io/@dldc/tower
`);
}

if (import.meta.main) {
  main();
}
