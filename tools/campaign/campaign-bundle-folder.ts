import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Bundle files of an earlier export: content-hash names in the two data folders, nothing else is touched. */
const HASHED_FILE = /^[0-9a-f]{64}\.(map|webp)$/;
const DATA_FOLDERS = ["maps", "images"] as const;

const staleFiles = (directory: string, kept: ReadonlySet<string>) =>
  DATA_FOLDERS.flatMap(folder => {
    const names = readdirSync(join(directory, folder), { withFileTypes: true });
    return names
      .filter(entry => entry.isFile() && HASHED_FILE.test(entry.name) && !kept.has(`${folder}/${entry.name}`))
      .map(entry => `${folder}/${entry.name}`);
  });

/**
 * Writes the bundle's files into `directory` and removes the hashed map and image files the new index no longer
 * names. Returns the removed relative paths.
 */
export const writeCampaignBundleFolder = (directory: string, files: ReadonlyMap<string, Uint8Array>) => {
  for (const folder of DATA_FOLDERS) mkdirSync(join(directory, folder), { recursive: true });
  for (const [path, bytes] of files) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), bytes);
  }
  const removed = staleFiles(directory, new Set(files.keys()));
  for (const path of removed) rmSync(join(directory, path));
  return removed;
};
