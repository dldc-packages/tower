/**
 * Intent schema validation
 *
 * Validates intent.json against the schema defined in types.ts
 */

import type { Intent } from "@dldc/tower/types";
import { ValidationError } from "../utils/errors.ts";

/**
 * Validate intent.json structure
 */
export function validateIntent(data: unknown): Intent {
  if (!isObject(data)) {
    throw new ValidationError("Intent must be an object");
  }

  // Validate version
  if (data.version !== "1") {
    throw new ValidationError(`Unsupported intent version: ${data.version}`);
  }

  // Validate adminEmail
  if (typeof data.adminEmail !== "string" || !data.adminEmail.includes("@")) {
    throw new ValidationError("Invalid adminEmail");
  }

  // Validate tower section
  validateTowerSection(data.tower);

  // Validate registry section
  validateRegistrySection(data.registry);

  // Validate otel section
  validateOtelSection(data.otel);

  // Validate apps array
  if (!Array.isArray(data.apps)) {
    throw new ValidationError("apps must be an array");
  }

  for (let i = 0; i < data.apps.length; i++) {
    validateApp(data.apps[i], i);
  }

  // Check for duplicate app names
  const names = new Set<string>();
  for (const app of data.apps) {
    if (names.has(app.name)) {
      throw new ValidationError(`Duplicate app name: ${app.name}`);
    }
    names.add(app.name);
  }

  return data as unknown as Intent;
}

function validateTowerSection(tower: unknown): void {
  if (!isObject(tower)) {
    throw new ValidationError("tower section must be an object");
  }

  if (typeof tower.version !== "string" || !tower.version) {
    throw new ValidationError("tower.version must be a non-empty string");
  }

  if (typeof tower.domain !== "string" || !isValidDomain(tower.domain)) {
    throw new ValidationError("tower.domain must be a valid domain");
  }
}

function validateRegistrySection(registry: unknown): void {
  if (!isObject(registry)) {
    throw new ValidationError("registry section must be an object");
  }

  if (typeof registry.domain !== "string" || !isValidDomain(registry.domain)) {
    throw new ValidationError("registry.domain must be a valid domain");
  }
}

function validateOtelSection(otel: unknown): void {
  if (!isObject(otel)) {
    throw new ValidationError("otel section must be an object");
  }

  if (typeof otel.version !== "string" || !otel.version) {
    throw new ValidationError("otel.version must be a non-empty string");
  }

  if (typeof otel.domain !== "string" || !isValidDomain(otel.domain)) {
    throw new ValidationError("otel.domain must be a valid domain");
  }
}

function validateApp(app: unknown, index: number): void {
  if (!isObject(app)) {
    throw new ValidationError(`apps[${index}] must be an object`);
  }

  if (typeof app.name !== "string" || !isValidAppName(app.name)) {
    throw new ValidationError(`apps[${index}].name must be a valid identifier`);
  }

  if (typeof app.image !== "string" || !app.image) {
    throw new ValidationError(`apps[${index}].image must be a non-empty string`);
  }

  if (typeof app.domain !== "string" || !isValidDomain(app.domain)) {
    throw new ValidationError(`apps[${index}].domain must be a valid domain`);
  }

  if (app.port !== undefined && (typeof app.port !== "number" || app.port <= 0)) {
    throw new ValidationError(`apps[${index}].port must be a positive number`);
  }

  if (app.env !== undefined && !isStringRecord(app.env)) {
    throw new ValidationError(`apps[${index}].env must be a string record`);
  }

  if (app.secrets !== undefined && !isStringRecord(app.secrets)) {
    throw new ValidationError(`apps[${index}].secrets must be a string record`);
  }

  if (app.healthCheck !== undefined) {
    validateHealthCheck(app.healthCheck, index);
  }
}

function validateHealthCheck(healthCheck: unknown, appIndex: number): void {
  if (!isObject(healthCheck)) {
    throw new ValidationError(`apps[${appIndex}].healthCheck must be an object`);
  }

  if (healthCheck.path !== undefined && typeof healthCheck.path !== "string") {
    throw new ValidationError(`apps[${appIndex}].healthCheck.path must be a string`);
  }

  if (healthCheck.port !== undefined && typeof healthCheck.port !== "number") {
    throw new ValidationError(`apps[${appIndex}].healthCheck.port must be a number`);
  }

  if (healthCheck.interval !== undefined && typeof healthCheck.interval !== "number") {
    throw new ValidationError(`apps[${appIndex}].healthCheck.interval must be a number`);
  }

  if (healthCheck.timeout !== undefined && typeof healthCheck.timeout !== "number") {
    throw new ValidationError(`apps[${appIndex}].healthCheck.timeout must be a number`);
  }

  if (healthCheck.retries !== undefined && typeof healthCheck.retries !== "number") {
    throw new ValidationError(`apps[${appIndex}].healthCheck.retries must be a number`);
  }
}

// Utility functions

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isObject(value)) return false;
  return Object.values(value).every((v) => typeof v === "string");
}

function isValidDomain(domain: string): boolean {
  // Basic domain validation
  const domainRegex =
    /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;
  return domainRegex.test(domain);
}

function isValidAppName(name: string): boolean {
  // App names must be valid Docker service names
  const nameRegex = /^[a-z0-9]([a-z0-9_-]*[a-z0-9])?$/;
  return nameRegex.test(name);
}
