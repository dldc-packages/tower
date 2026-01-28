/**
 * Caddy JSON generator
 *
 * Generate Caddy JSON config with routes for all services.
 */

import { ResolvedService } from "../core/services.ts";

export function generateCaddyJson(
  services: ResolvedService[],
  adminEmail: string,
): string {
  console.log("Generating Caddy JSON config...");

  const domains = new Set<string>();
  const routes: Array<Record<string, unknown>> = [];

  for (const svc of services) {
    const serviceName = svc.name;

    // Skip caddy service itself
    if (serviceName === "caddy") continue;

    const ingressList = svc.ingress ?? [];

    for (const ingress of ingressList) {
      const upstreamDial = `${serviceName}:${ingress.port}`;
      const auth = svc.auth;

      // Add all domains from this ingress to the domain set
      for (const domain of ingress.domains) {
        domains.add(domain);
      }

      if (auth) {
        // Service requires basic auth for all requests
        const account = { username: auth.username, password: auth.passwordHash };
        routes.push(buildBasicAuthRoute(ingress.domains, upstreamDial, account));
      } else {
        // No auth required, simple reverse proxy
        routes.push(buildOpenRoute(ingress.domains, upstreamDial));
      }
    }
  }

  const config = {
    apps: {
      tls: {
        automation: {
          policies: [
            {
              subjects: Array.from(domains),
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
  domains: string[],
  upstreamDial: string,
  account: Record<string, unknown>,
): Record<string, unknown> {
  return {
    match: [{ host: domains }],
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

function buildOpenRoute(domains: string[], upstreamDial: string): Record<string, unknown> {
  return {
    match: [{ host: domains }],
    handle: [{ handler: "reverse_proxy", upstreams: [{ dial: upstreamDial }] }],
    terminal: true,
  };
}
