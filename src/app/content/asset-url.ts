import { type AssetRef, fillPathTokens, type PathTokenValues } from "@shared/catalog";

/**
 * Content catalog asset references resolved to bundled URLs. Vite needs static globs, so there is one glob per
 * asset folder the catalog uses; a new icon folder adds its glob here.
 */
const CLIENT_ASSET_PREFIX = "../../../assets/";
const clientAssetUrls = import.meta.glob<string>([
  "../../../assets/commander-portraits/*.png", "../../../assets/editor-icons/*.webp",
  "../../../assets/troop-portraits/*.png",
  "../../../assets/ui-icons/army-*.png", "../../../assets/ui-icons/roman-merchant-ship.png",
  "../../../assets/ui-icons/ships/*.png", "../../../assets/ware-icons/*.png", "../../../assets/worker-icons/*.png"
], { eager: true, import: "default", query: "?url" });

/**
 * The URL of a catalog asset with its tokens filled: bundled `clientAssets` through their glob (undefined when no
 * such file is bundled), `clientPublic` files below the deployment base URL.
 */
export const resolveAssetUrl = (ref: AssetRef, values: PathTokenValues): string | undefined => {
  if (ref.root === "clientPublic") return `${import.meta.env.BASE_URL}${fillPathTokens(ref.path, values)}`;
  if (ref.root !== "clientAssets") return undefined;
  return clientAssetUrls[`${CLIENT_ASSET_PREFIX}${fillPathTokens(ref.path, values)}`];
};
