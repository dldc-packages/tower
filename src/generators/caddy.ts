/**
 * Caddy JSON generator
 *
 * Generate Caddy JSON config with routes for all services.
 */

import { ResolvedService } from "../core/services.ts";
import { logger } from "../utils/logger.ts";

export function generateCaddyJson(
  services: ResolvedService[],
  adminEmail: string,
): string {
  logger.info("Generating Caddy JSON config...");

  const domains = Array.from(
    new Set(services.map((s) => s.domain).filter(Boolean)),
  );
  const routes: Array<Record<string, unknown>> = [];

  for (const svc of services) {
    const serviceName = svc.name;
    const domain = svc.domain;
    const port = svc.port;

    if (!domain || serviceName === "caddy") continue;

    const upstreamDial = `${serviceName}:${port}`;
    const auth = svc.auth;

    if (auth) {
      // Service requires basic auth for all requests
      const account = { username: auth.username, password: auth.passwordHash };
      routes.push(buildBasicAuthRoute(domain, upstreamDial, account));
    } else {
      // No auth required, simple reverse proxy
      routes.push(buildOpenRoute(domain, upstreamDial));
    }
  }

  const config = {
    apps: {
      tls: {
        automation: {
          policies: [
            {
              subjects: domains,
              issuers: [{ module: "acme", email: adminEmail }],
            },
          ],
        },
      },
      http: {
        servers: {
          https: {
            listen: [":443"],
            tls_connection_policies: [{}],
            routes,
          },
          http: {
            listen: [":80"],
            routes: [
              {
                handle: [
                  {
                    handler: "static_response",
                    status_code: 308,
                    headers: {
                      Location: [
                        "https://{http.request.host}{http.request.uri}",
                      ],
                    },
                  },
                ],
                terminal: true,
              },
            ],
          },
        },
      },
    },
  } as const;

  return JSON.stringify(config, null, 2);
}

function buildBasicAuthRoute(
  domain: string,
  upstreamDial: string,
  account: Record<string, unknown>,
): Record<string, unknown> {
  return {
    match: [{ host: [domain] }],
    handle: [
      {
        handler: "authentication",
        providers: { http_basic: { accounts: [account] } },
      },
      { handler: "reverse_proxy", upstreams: [{ dial: upstreamDial }] },
    ],
    terminal: true,
  };
}

function buildOpenRoute(domain: string, upstreamDial: string): Record<string, unknown> {
  return {
    match: [{ host: [domain] }],
    handle: [{ handler: "reverse_proxy", upstreams: [{ dial: upstreamDial }] }],
    terminal: true,
  };
}
