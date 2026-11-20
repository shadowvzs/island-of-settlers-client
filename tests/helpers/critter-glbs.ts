import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The client package folder: Vite serves the critter GLB URLs (`/assets/...`) from here. */
const CLIENT_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** Reads a shipped critter GLB from disk by its Vite asset URL (the tests' `CritterGlbFetch`). */
export const readCritterGlbFromDisk = async (url: string): Promise<ArrayBuffer> => {
  const bytes = await readFile(join(CLIENT_ROOT, url));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
};
