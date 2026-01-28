/**
 * Caddy JSON generator
 *
 * Generate Caddy JSON config with routes for all services.
 */

import type { AuthScope, BasicAuthUser, ResolvedService } from "../core/types.ts";
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

    const upstreamPort = svc.upstreamPort ?? port;
    const upstreamDial = `${svc.upstreamName ?? serviceName}:${upstreamPort}`;
    const auth = svc.auth;
    const accounts = toBasicAccounts(auth?.basicUsers);

    if (
      (auth?.policy === "basic_all" || auth?.policy === "basic_write_only" ||
        auth?.policy === "basic_scoped") && accounts.length === 0
    ) {
      logger.warn(
        `Service "${serviceName}" uses auth policy=${auth?.policy} but has no basic auth users configured`,
      );
    }

    if (auth?.policy === "basic_all") {
      routes.push(buildBasicAllRoute(domain, upstreamDial, accounts));
      continue;
    }

    if (auth?.policy === "basic_write_only" || auth?.policy === "basic_scoped") {
      const scopes = normalizeScopes(auth?.scopes, auth?.policy);
      routes.push(buildScopedRoute(domain, upstreamDial, accounts, scopes));
      continue;
    }

    // Default: no auth, reverse proxy
    routes.push(buildOpenRoute(domain, upstreamDial));
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

function toBasicAccounts(users?: BasicAuthUser[]) {
  return (users ?? []).map((u) => ({ username: u.username, password: u.passwordHash }));
}

function buildBasicAllRoute(
  domain: string,
  upstreamDial: string,
  accounts: Array<Record<string, unknown>>,
): Record<string, unknown> {
  return {
    match: [{ host: [domain] }],
    handle: [
      {
        handler: "authentication",
        providers: { http_basic: { accounts } },
      },
      { handler: "reverse_proxy", upstreams: [{ dial: upstreamDial }] },
    ],
    terminal: true,
  };
}

function normalizeScopes(
  scopes: AuthScope[] | undefined,
  policy: "basic_write_only" | "basic_scoped",
): AuthScope[] {
  const hasCustomScopes = scopes?.length;
  if (hasCustomScopes) {
    return scopes!.filter((scope) =>
      (scope.path?.length ?? 0) > 0 || (scope.method?.length ?? 0) > 0
    );
  }

  if (policy === "basic_write_only") {
    return [
      {
        path: ["/v2/*"],
        method: ["POST", "PUT", "PATCH", "DELETE"],
      },
    ];
  }

  return [];
}

function buildScopedRoute(
  domain: string,
  upstreamDial: string,
  accounts: Array<Record<string, unknown>>,
  scopes: AuthScope[],
): Record<string, unknown> {
  const protectedRoutes = scopes.map((scope) => ({
    match: [
      {
        ...(scope.path ? { path: scope.path } : {}),
        ...(scope.method ? { method: scope.method } : {}),
      },
    ],
    handle: [
      {
        handler: "authentication",
        providers: { http_basic: { accounts } },
      },
      { handler: "reverse_proxy", upstreams: [{ dial: upstreamDial }] },
    ],
  }));

  const fallback = {
    handle: [{ handler: "reverse_proxy", upstreams: [{ dial: upstreamDial }] }],
  };

  // If no scopes are provided, fall back to protecting everything.
  if (protectedRoutes.length === 0) {
    return buildBasicAllRoute(domain, upstreamDial, accounts);
  }

  return {
    match: [{ host: [domain] }],
    handle: [
      {
        handler: "subroute",
        routes: [...protectedRoutes, fallback],
      },
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
