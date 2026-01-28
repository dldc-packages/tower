/**
 * Docker Registry HTTP client
 *
 * Interacts with Docker Registry v2 API for image resolution.
 */

import { RegistryError } from "../utils/errors.ts";
import { basicAuth, getJson } from "../utils/http.ts";

export interface RegistryClient {
  baseUrl: string;
  username?: string;
  password?: string;
}

/**
 * Create a registry client
 */
export function createRegistryClient(
  baseUrl: string,
  username?: string,
  password?: string,
): RegistryClient {
  return { baseUrl, username, password };
}

/**
 * List all tags for a repository
 */
export async function listTags(
  client: RegistryClient,
  repository: string,
): Promise<string[]> {
  const url = `${client.baseUrl}/v2/${repository}/tags/list`;
  const headers = client.username && client.password
    ? { Authorization: basicAuth(client.username, client.password) }
    : undefined;

  try {
    const response = await getJson<{ tags: string[] }>(url, headers);
    return response.tags ?? [];
  } catch (error) {
    console.error(`Failed to list tags for ${repository}:`, error);
    throw new RegistryError(`Failed to list tags: ${repository}`, { cause: error });
  }
}

/**
 * Get image digest for a specific tag
 */
export async function getDigest(
  client: RegistryClient,
  repository: string,
  tag: string,
): Promise<string> {
  const url = `${client.baseUrl}/v2/${repository}/manifests/${tag}`;
  const headers = {
    Accept: "application/vnd.docker.distribution.manifest.v2+json",
    ...(client.username && client.password
      ? { Authorization: basicAuth(client.username, client.password) }
      : {}),
  };

  try {
    const response = await fetch(url, { method: "HEAD", headers });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`HTTP ${response.status}`, { cause: new Error(errorText) });
    }

    const digest = response.headers.get("Docker-Content-Digest");
    if (!digest) {
      throw new Error("No digest header in response");
    }

    return digest;
  } catch (error) {
    console.error(`Failed to get digest for ${repository}:${tag}:`, error);
    throw new RegistryError(`Failed to get digest: ${repository}:${tag}`, { cause: error });
  }
}

/**
 * Parse image reference into components
 */
export function parseImageRef(imageRef: string): {
  registry: string;
  repository: string;
  tag?: string;
  digest?: string;
} {
  // Format: registry.example.com/repository:tag
  // or: registry.example.com/repository@sha256:...

  const digestMatch = imageRef.match(/^([^@]+)@(.+)$/);
  if (digestMatch) {
    const [, path, digest] = digestMatch;
    const [registry, ...repoParts] = path.split("/");
    return {
      registry,
      repository: repoParts.join("/"),
      digest,
    };
  }

  const tagMatch = imageRef.match(/^([^:]+):(.+)$/);
  if (tagMatch) {
    const [, path, tag] = tagMatch;
    const [registry, ...repoParts] = path.split("/");
    return {
      registry,
      repository: repoParts.join("/"),
      tag,
    };
  }

  // No tag or digest, assume "latest"
  const [registry, ...repoParts] = imageRef.split("/");
  return {
    registry,
    repository: repoParts.join("/"),
    tag: "latest",
  };
}
