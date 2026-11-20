import { resolve } from "node:path";
import { type AssetRef, type AssetRoot, type ContentEntry, entryTokenValues, fillPathTokens,
  type PathTokenValues } from "@shared/catalog";

const CLIENT = resolve(import.meta.dirname, "../..");

/** Folders of the catalog asset roots (catalog README, "References"). */
export const CATALOG_ASSET_ROOTS: Readonly<Record<AssetRoot, string>> = {
  clientAssets: resolve(CLIENT, "assets"),
  clientPublic: resolve(CLIENT, "public"),
  workerRepo: resolve(CLIENT, "../island-of-settlers-worker-generation/game_ready")
};

/** The absolute file of a catalog asset reference with its tokens filled. */
export const catalogAssetFile = (ref: AssetRef, values: PathTokenValues) =>
  resolve(CATALOG_ASSET_ROOTS[ref.root], fillPathTokens(ref.path, values));

/** The icon file of one entry instance (`entry.icon` with `key`, `code` and the given axis values). */
export const catalogIconFile = (entry: ContentEntry, values: PathTokenValues = {}) => {
  if (!entry.icon) throw new Error(`${entry.id} has no icon`);
  return catalogAssetFile(entry.icon, { code: entry.code ?? "", key: entry.key, ...values });
};

/** Every file an asset reference of the entry names over its declared variants. */
export const catalogAssetFiles = (entry: ContentEntry, ref: AssetRef) =>
  entryTokenValues(entry).map(values => catalogAssetFile(ref, values));
