/**
 * Semver range matching
 *
 * Match semver version ranges to available tags.
 */

/**
 * Match semver range against available tags and return best match
 */
export function matchSemverRange(range: string, tags: string[]): string | null {
  console.log(`Matching semver range: ${range} against ${tags.length} tags`);

  // Filter tags that look like semver
  const semverTags = tags.filter(isSemverTag);

  if (semverTags.length === 0) {
    console.log("No semver tags found");
    return null;
  }

  // Parse range
  const matcher = parseRange(range);

  // Find matching tags
  const matches = semverTags.filter((tag) => matcher(tag));

  if (matches.length === 0) {
    console.log(`No tags match range: ${range}`);
    return null;
  }

  // Sort by semver and return latest
  const sorted = matches.sort(compareSemver).reverse();
  console.log(`Best match: ${sorted[0]}`);

  return sorted[0];
}

/**
 * Check if a tag looks like semver
 */
function isSemverTag(tag: string): boolean {
  // Remove 'v' prefix if present
  const normalized = tag.startsWith("v") ? tag.slice(1) : tag;
  return /^\d+\.\d+\.\d+(-[a-z0-9.-]+)?(\+[a-z0-9.-]+)?$/i.test(normalized);
}

/**
 * Parse a semver range into a matcher function
 */
function parseRange(range: string): (tag: string) => boolean {
  // Handle common range patterns:
  // - "^1.2.3" - compatible with 1.2.3 (>=1.2.3 <2.0.0)
  // - "~1.2.3" - approximately 1.2.3 (>=1.2.3 <1.3.0)
  // - "1.2.3" - exact match
  // - "1.2.*" - any patch version
  // - "1.*" - any minor/patch version

  const normalized = range.startsWith("v") ? range.slice(1) : range;

  // Exact match
  if (/^\d+\.\d+\.\d+$/.test(normalized)) {
    return (tag: string) => normalizeTag(tag) === normalized;
  }

  // Wildcard patterns
  if (normalized.includes("*")) {
    const pattern = normalized.replace(/\*/g, "\\d+");
    const regex = new RegExp(`^${pattern}$`);
    return (tag: string) => regex.test(normalizeTag(tag));
  }

  // Caret range (^1.2.3)
  if (normalized.startsWith("^")) {
    const version = normalized.slice(1);
    const [major, minor] = version.split(".").map(Number);
    return (tag: string) => {
      const [tagMajor, tagMinor, tagPatch] = normalizeTag(tag).split(".").map(Number);
      return tagMajor === major && (
        tagMinor > minor || (tagMinor === minor && tagPatch !== undefined)
      );
    };
  }

  // Tilde range (~1.2.3)
  if (normalized.startsWith("~")) {
    const version = normalized.slice(1);
    const [major, minor] = version.split(".").map(Number);
    return (tag: string) => {
      const [tagMajor, tagMinor] = normalizeTag(tag).split(".").map(Number);
      return tagMajor === major && tagMinor === minor;
    };
  }

  // Fallback: treat as exact match
  return (tag: string) => normalizeTag(tag) === normalized;
}

/**
 * Normalize tag by removing 'v' prefix
 */
function normalizeTag(tag: string): string {
  return tag.startsWith("v") ? tag.slice(1) : tag;
}

/**
 * Compare two semver strings
 */
function compareSemver(a: string, b: string): number {
  const aParts = normalizeTag(a).split(".").map(Number);
  const bParts = normalizeTag(b).split(".").map(Number);

  for (let i = 0; i < 3; i++) {
    const aPart = aParts[i] ?? 0;
    const bPart = bParts[i] ?? 0;

    if (aPart !== bPart) {
      return aPart - bPart;
    }
  }

  return 0;
}
