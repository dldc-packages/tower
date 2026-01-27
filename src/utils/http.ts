/**
 * HTTP client utilities
 *
 * Simple HTTP client for registry API and other services.
 */

import { logger } from "./logger.ts";

export interface HttpOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  timeout?: number;
}

/**
 * Make HTTP request
 */
export async function request(url: string, options: HttpOptions = {}): Promise<Response> {
  const {
    method = "GET",
    headers = {},
    body,
    timeout = 30000,
  } = options;

  logger.debug(`HTTP ${method} ${url}`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body as BodyInit | null | undefined,
      signal: controller.signal,
    });

    logger.debug(`HTTP ${method} ${url} -> ${response.status}`);
    return response;
  } catch (error) {
    logger.error(`HTTP ${method} ${url} failed:`, error);
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Make GET request and parse JSON response
 */
export async function getJson<T>(url: string, headers?: Record<string, string>): Promise<T> {
  const response = await request(url, { method: "GET", headers });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}`, { cause: new Error(errorText) });
  }

  return await response.json() as T;
}

/**
 * Make POST request with JSON body
 */
export async function postJson<T>(
  url: string,
  data: unknown,
  headers?: Record<string, string>,
): Promise<T> {
  const response = await request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}`, { cause: new Error(errorText) });
  }

  return await response.json() as T;
}

/**
 * Create Basic Auth header value
 */
export function basicAuth(username: string, password: string): string {
  const credentials = btoa(`${username}:${password}`);
  return `Basic ${credentials}`;
}

/**
 * Parse Basic Auth header
 */
export function parseBasicAuth(header: string): { username: string; password: string } | null {
  if (!header.startsWith("Basic ")) {
    return null;
  }

  try {
    const credentials = atob(header.slice(6));
    const [username, password] = credentials.split(":", 2);
    return { username, password };
  } catch {
    return null;
  }
}
