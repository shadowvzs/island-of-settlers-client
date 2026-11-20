import { getContentEntry } from "@shared/catalog";

import { resolveAssetUrl } from "../../content/asset-url";

/** The catalog icon of a content id (a static row's icon), or null when the entry has none bundled. */
export const contentIconUrl = (contentId: string) => {
  const entry = getContentEntry(contentId);
  return (entry?.icon && resolveAssetUrl(entry.icon, { key: entry.key })) ?? null;
};
