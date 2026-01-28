/**
 * Intent schema validation
 *
 * Validates intent.json against the schema defined in types.ts
 */

import * as v from "@valibot/valibot";
import type { App, HealthCheck, Intent } from "../types.ts";
import { ValidationError } from "../utils/errors.ts";

// Domain validation regex
const DOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;

// App name validation regex (valid Docker service names)
const APP_NAME_REGEX = /^[a-z0-9]([a-z0-9_-]*[a-z0-9])?$/;

// Environment variable name regex
const ENV_VAR_NAME_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

// Reserved infrastructure service names
const RESERVED_NAMES = new Set([
  "caddy",
  "registry",
  "tower",
  "otel-lgtm",
  "otel",
  "loki",
  "tempo",
  "grafana",
]);

// Custom validators
const domainSchema: v.GenericSchema<string> = v.pipe(
  v.string(),
  v.regex(DOMAIN_REGEX, "Must be a valid domain name"),
);

const appNameSchema: v.GenericSchema<string> = v.pipe(
  v.string(),
  v.regex(
    APP_NAME_REGEX,
    "Must be a valid Docker service name (lowercase alphanumeric, underscores, and hyphens)",
  ),
);

const emailSchema: v.GenericSchema<string> = v.pipe(
  v.string(),
  v.email("Must be a valid email address"),
);

// Health check schema
const healthCheckSchema: v.GenericSchema<HealthCheck | undefined> = v.optional(
  v.object({
    path: v.optional(v.string()),
    port: v.optional(v.number()),
    interval: v.optional(v.number()),
    timeout: v.optional(v.number()),
    retries: v.optional(v.number()),
  }),
);

// Volume schema
const volumeSchema = v.union([
  v.object({
    type: v.literal("bind"),
    source: v.string(),
    target: v.string(),
    readonly: v.optional(v.boolean()),
  }),
  v.object({
    type: v.literal("named"),
    name: v.string(),
    target: v.string(),
    readonly: v.optional(v.boolean()),
  }),
]);

// Port schema
const portSchema = v.object({
  host: v.pipe(v.number(), v.minValue(1, "Port must be positive")),
  container: v.pipe(v.number(), v.minValue(1, "Port must be positive")),
  protocol: v.optional(v.picklist(["tcp", "udp"])),
});

// Auth schema
const basicAuthUserSchema = v.object({
  username: v.string(),
  passwordHash: v.string(),
});

const authScopeSchema = v.object({
  path: v.optional(v.array(v.string())),
  method: v.optional(v.array(v.string())),
});

const authSchema = v.optional(
  v.object({
    policy: v.picklist(["none", "basic_all", "basic_write_only", "basic_scoped"]),
    basicUsers: v.optional(v.array(basicAuthUserSchema)),
    scopes: v.optional(v.array(authScopeSchema)),
  }),
);

// App schema
const appSchema: v.GenericSchema<App> = v.object({
  name: appNameSchema,
  image: v.pipe(v.string(), v.minLength(1, "Image must not be empty")),
  domain: domainSchema,
  port: v.optional(v.pipe(v.number(), v.minValue(1, "Port must be positive"))),
  env: v.optional(v.record(v.string(), v.string())),
  secrets: v.optional(v.record(v.string(), v.string())),
  healthCheck: healthCheckSchema,
  restart: v.optional(v.string()),
  volumes: v.optional(v.array(volumeSchema)),
  ports: v.optional(v.array(portSchema)),
  command: v.optional(v.array(v.string())),
  auth: authSchema,
});

// Intent schema
const intentSchema: v.GenericSchema<Intent> = v.object({
  version: v.literal("1"),
  adminEmail: emailSchema,
  dataDir: v.optional(v.string()),
  tower: v.object({
    version: v.pipe(v.string(), v.minLength(1, "Tower version must not be empty")),
    domain: domainSchema,
    username: v.pipe(v.string(), v.minLength(1, "Tower username must not be empty")),
    passwordHash: v.pipe(v.string(), v.minLength(1, "Tower password hash must not be empty")),
  }),
  registry: v.object({
    domain: domainSchema,
    username: v.pipe(v.string(), v.minLength(1, "Registry username must not be empty")),
    passwordHash: v.pipe(v.string(), v.minLength(1, "Registry password hash must not be empty")),
  }),
  otel: v.object({
    version: v.pipe(v.string(), v.minLength(1, "OTEL version must not be empty")),
    domain: domainSchema,
    username: v.pipe(v.string(), v.minLength(1, "OTEL username must not be empty")),
    passwordHash: v.pipe(v.string(), v.minLength(1, "OTEL password hash must not be empty")),
  }),
  apps: v.array(appSchema),
});

/**
 * Validate intent.json structure
 */
export function validateIntent(data: unknown): Intent {
  // Validate with valibot
  const result = v.safeParse(intentSchema, data);

  if (!result.success) {
    // Format valibot errors into a readable message
    const issues = v.flatten(result.issues);
    const errorMessages: string[] = [];

    if (issues.nested) {
      for (const [path, pathIssues] of Object.entries(issues.nested)) {
        if (pathIssues) {
          errorMessages.push(`${path}: ${pathIssues.join(", ")}`);
        }
      }
    }

    if (issues.root) {
      errorMessages.push(...issues.root);
    }

    throw new ValidationError(
      `Intent validation failed:\n${errorMessages.join("\n")}`,
    );
  }

  const intent = result.output;

  // Additional custom validations

  // 1. Check for duplicate app names and reserved names
  const appNames = new Set<string>();
  const infraDomains = new Set([intent.tower.domain, intent.registry.domain, intent.otel.domain]);

  for (const app of intent.apps) {
    if (appNames.has(app.name)) {
      throw new ValidationError(`Duplicate app name: ${app.name}`);
    }
    if (RESERVED_NAMES.has(app.name)) {
      throw new ValidationError(
        `App name "${app.name}" is reserved for infrastructure services`,
      );
    }
    appNames.add(app.name);
  }

  // 2. Check for domain conflicts
  const allDomains = new Map<string, string>();
  allDomains.set(intent.tower.domain, "tower");
  allDomains.set(intent.registry.domain, "registry");
  allDomains.set(intent.otel.domain, "otel");

  for (const app of intent.apps) {
    if (allDomains.has(app.domain)) {
      const existing = allDomains.get(app.domain);
      throw new ValidationError(
        `Domain "${app.domain}" is already used by ${existing}`,
      );
    }
    if (infraDomains.has(app.domain)) {
      throw new ValidationError(
        `Domain "${app.domain}" conflicts with infrastructure domain`,
      );
    }
    allDomains.set(app.domain, `app "${app.name}"`);
  }

  // 3. Validate app-specific constraints
  for (const app of intent.apps) {
    // Validate port range
    if (app.port && (app.port < 1 || app.port > 65535)) {
      throw new ValidationError(`App "${app.name}" port must be between 1 and 65535`);
    }

    // Validate health check constraints
    if (app.healthCheck) {
      validateHealthCheckConstraints(app.name, app.healthCheck);
    }

    // Validate environment variable names
    if (app.env) {
      for (const [key] of Object.entries(app.env)) {
        if (!ENV_VAR_NAME_REGEX.test(key)) {
          throw new ValidationError(
            `App "${app.name}" env key "${key}" is not a valid environment variable name`,
          );
        }
      }
    }

    if (app.secrets) {
      for (const [key] of Object.entries(app.secrets)) {
        if (!ENV_VAR_NAME_REGEX.test(key)) {
          throw new ValidationError(
            `App "${app.name}" secret key "${key}" is not a valid environment variable name`,
          );
        }
      }
    }

    // Validate image reference format
    validateImageReference(app.name, app.image);
  }

  return intent;
}

/**
 * Validate health check constraints
 */
function validateHealthCheckConstraints(appName: string, healthCheck: HealthCheck): void {
  const interval = healthCheck.interval ?? 10;
  const timeout = healthCheck.timeout ?? 5;
  const retries = healthCheck.retries ?? 3;

  // Timeout should be less than interval
  if (timeout >= interval) {
    throw new ValidationError(
      `App "${appName}" healthCheck timeout (${timeout}s) must be less than interval (${interval}s)`,
    );
  }

  // Validate reasonable values
  if (interval < 1 || interval > 300) {
    throw new ValidationError(
      `App "${appName}" healthCheck interval must be between 1 and 300 seconds`,
    );
  }

  if (timeout < 1 || timeout > 60) {
    throw new ValidationError(
      `App "${appName}" healthCheck timeout must be between 1 and 60 seconds`,
    );
  }

  if (retries < 0 || retries > 10) {
    throw new ValidationError(
      `App "${appName}" healthCheck retries must be between 0 and 10`,
    );
  }

  // If path is provided, it must start with /
  if (healthCheck.path && !healthCheck.path.startsWith("/")) {
    throw new ValidationError(
      `App "${appName}" healthCheck path must start with "/"`,
    );
  }
}

/**
 * Validate Docker image reference format
 */
function validateImageReference(appName: string, imageRef: string): void {
  // Basic image reference validation
  // Format: [registry/]repository[:tag|@digest]

  if (!imageRef || imageRef.trim() === "") {
    throw new ValidationError(`App "${appName}" image reference must not be empty`);
  }

  // Check for invalid characters (basic validation)
  if (/[\s]/.test(imageRef)) {
    throw new ValidationError(
      `App "${appName}" image reference contains invalid whitespace`,
    );
  }

  // Warn about images without registry (optional - could be local or docker hub)
  // For now just validate format is reasonable
  const parts = imageRef.split("/");
  if (parts.length > 0) {
    const lastPart = parts[parts.length - 1];
    // Check that it has at least a repository name
    if (!lastPart || lastPart.trim() === "") {
      throw new ValidationError(
        `App "${appName}" image reference format is invalid`,
      );
    }
  }
}
