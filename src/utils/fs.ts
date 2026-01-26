/**
 * File system utilities
 *
 * Helpers for reading/writing Tower configuration files.
 */

import { logger } from "./logger.ts";

/**
 * Ensure directory exists, create if missing
 */
export async function ensureDir(path: string): Promise<void> {
  try {
    await Deno.mkdir(path, { recursive: true });
  } catch (error) {
    if (!(error instanceof Deno.errors.AlreadyExists)) {
      throw error;
    }
  }
}

/**
 * Read file as text
 */
export async function readTextFile(path: string): Promise<string> {
  try {
    return await Deno.readTextFile(path);
  } catch (error) {
    logger.error(`Failed to read file: ${path}`, error);
    throw error;
  }
}

/**
 * Write text to file
 */
export async function writeTextFile(path: string, content: string): Promise<void> {
  try {
    await Deno.writeTextFile(path, content);
    logger.debug(`Wrote file: ${path}`);
  } catch (error) {
    logger.error(`Failed to write file: ${path}`, error);
    throw error;
  }
}

/**
 * Read JSON file
 */
export async function readJsonFile<T>(path: string): Promise<T> {
  const text = await readTextFile(path);
  return JSON.parse(text) as T;
}

/**
 * Write JSON file (pretty-printed)
 */
export async function writeJsonFile(path: string, data: unknown): Promise<void> {
  const json = JSON.stringify(data, null, 2);
  await writeTextFile(path, json);
}

/**
 * Check if file exists
 */
export async function fileExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return false;
    }
    throw error;
  }
}

/**
 * Check if directory exists
 */
export async function dirExists(path: string): Promise<boolean> {
  try {
    const stat = await Deno.stat(path);
    return stat.isDirectory;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return false;
    }
    throw error;
  }
}
