import type { I18n } from "@lingui/core";
import {
  type AssetRef, catalogEntries, type ContentEntryBase, type ContentKind, entriesInFamily, getContentEntry
} from "@shared/catalog";

import { contentDescriptor } from "../../../shared/i18n/content-text";
import { translateMessage } from "../../../shared/i18n/translate";
import { resolveAssetUrl } from "../../content/asset-url";
import type { RewardIconArt } from "../../settlement-ui/reward-icons/helpers";
import { getIconSources } from "../editor-icons";
import { foldSearchText } from "../reward-picker/catalog";
import { CATALOG_TABS, type CatalogTabId, ICON_STAND_INS, SETTLER_FALLBACK_PORTRAIT } from "./constants";
import { FAMILY_NAMES } from "./family-names";

/**
 * Catalog entries for the script pickers (design §13.3: type and family pickers over the one content catalog).
 * Entries are filtered like the validator does (`validate/content.ts`): kinds, the event capability or action
 * target name, and the slot's tag; names come from the catalog texts in the active locale.
 */

export type CapabilityMode = "event" | "action" | "query";

export interface CatalogFilter {
  kinds?: readonly ContentKind[];
  mode: CapabilityMode;
  requires: string | null;
  tag?: string;
}

export interface CatalogOption {
  /** A small second picture (a settler's tool on the shared carrier portrait, as in building details). */
  badge: RewardIconArt | null;
  entry: ContentEntryBase;
  icon: RewardIconArt | null;
  id: string;
  label: string;
  searchText: string;
}

export interface FamilyNode {
  /** Direct and nested member entries that pass the filter. */
  count: number;
  depth: number;
  label: string;
  /** Up to three member names (the family's preview). */
  members: string;
  path: string;
}

const EDITOR_ICON_PREFIX = "editor-icons/";
const FAMILY_PREVIEW_MEMBERS = 3;

const declares = (entry: ContentEntryBase, filter: CatalogFilter) => {
  if (!entry.actor) return false;
  if (filter.requires === null || filter.mode === "query") return true;
  const names = filter.mode === "event" ? entry.actor.capabilities : entry.actor.targetOf ?? [];
  return names.includes(filter.requires);
};

/** True when a type selector of this entry passes the slot (kind, capability, tag). */
export const entryMatches = (entry: ContentEntryBase, filter: CatalogFilter) =>
  !entry.retired && (!filter.kinds || filter.kinds.includes(entry.kind)) && declares(entry, filter) &&
  (!filter.tag || entry.tags.includes(filter.tag));

/** The display name of a catalog entry in the active locale (the id when the entry is unknown). */
export const contentName = (i18n: I18n | undefined, id: string) => {
  const entry = getContentEntry(id);
  return entry ? translateMessage(i18n, contentDescriptor(entry.text.name)) : id;
};

const editorIcon = (icon: AssetRef): RewardIconArt | null => {
  const name = icon.path.slice(EDITOR_ICON_PREFIX.length).replace(/\.[a-z]+$/, "");
  const sources = getIconSources(name);
  return sources ? { kind: "image", source: sources.src } : null;
};

const ownIcon = (entry: ContentEntryBase, nation: string): RewardIconArt | null => {
  if (entry.kind === "ware") return { kind: "ware", ware: entry.key };
  if (entry.kind === "building" && entry.code !== undefined) return { kind: "building", type: entry.code };
  if (!entry.icon) return null;
  if (entry.icon.path.startsWith(EDITOR_ICON_PREFIX)) return editorIcon(entry.icon);
  const source = resolveAssetUrl(entry.icon, { code: entry.code ?? "", key: entry.key, nation, rank: 0 });
  return source ? { kind: "image", source } : null;
};

/** The game's own stand-in of entries without an icon: a sibling entry's or a shared icon (see the receipt). */
const borrowedIcon = (entry: ContentEntryBase, nation: string): RewardIconArt | null => {
  const borrowed = ICON_STAND_INS[entry.id];
  if (borrowed?.startsWith(EDITOR_ICON_PREFIX)) return editorIcon({ path: borrowed, root: "clientAssets" });
  const sibling = borrowed && getContentEntry(borrowed);
  if (sibling) return ownIcon(sibling, nation);
  if (entry.kind !== "settler") return null;
  const carrier = getContentEntry(SETTLER_FALLBACK_PORTRAIT);
  return carrier ? ownIcon(carrier, nation) : null;
};

/** The picture of an entry: its own icon (wares, buildings, portraits, editor renders), else a stand-in. */
export const entryIcon = (entry: ContentEntryBase, nation: string): RewardIconArt | null =>
  ownIcon(entry, nation) ?? borrowedIcon(entry, nation);

/** A settler without its own portrait shows the carrier with its tool, like the building details workforce. */
export const entryBadge = (entry: ContentEntryBase, nation: string): RewardIconArt | null => {
  if (entry.kind !== "settler" || ownIcon(entry, nation)) return null;
  const tool = (entry as ContentEntryBase & { settler?: { tool?: string } }).settler?.tool;
  return tool ? { kind: "ware", ware: tool } : null;
};

const toOption = (entry: ContentEntryBase, i18n: I18n | undefined, nation: string): CatalogOption => {
  const label = translateMessage(i18n, contentDescriptor(entry.text.name));
  return { badge: entryBadge(entry, nation), entry, icon: entryIcon(entry, nation), id: entry.id, label,
    searchText: foldSearchText(`${label} ${entry.text.name.en} ${entry.key}`) };
};

/** The catalog picker's tabs for a filter: each offered kind group with its matching entries (empty tabs dropped). */
/** The active locale's translator; `locale` keys memoised lists (the Lingui instance itself is mutable). */
export interface CatalogLocale {
  i18n?: I18n;
  locale: string;
}

export const catalogTabs = (filter: CatalogFilter, { i18n }: CatalogLocale, nation: string) => {
  const entries = catalogEntries().filter(entry => entryMatches(entry, filter));
  return (Object.keys(CATALOG_TABS) as CatalogTabId[]).flatMap(tab => {
    const kinds: readonly ContentKind[] = CATALOG_TABS[tab];
    const options = entries.filter(entry => kinds.includes(entry.kind)).map(entry => toOption(entry, i18n, nation));
    return options.length ? [{ id: tab, options }] : [];
  });
};

/** Options whose folded search text contains every word of the query. */
export const filterCatalogOptions = (options: readonly CatalogOption[], query: string) => {
  const words = foldSearchText(query).split(/\s+/).filter(Boolean);
  if (!words.length) return options;
  return options.filter(option => words.every(word => option.searchText.includes(word)));
};

const familyPrefixes = (family: string) => {
  const parts = family.split(".");
  return parts.map((_, index) => parts.slice(0, index + 1).join("."));
};

const humanize = (segment: string) =>
  segment.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, letter => letter.toUpperCase());

/** The family tree (every family path prefix with matching members), depth-first in path order. */
export const familyTree = (filter: CatalogFilter, { i18n }: CatalogLocale): FamilyNode[] => {
  const members = new Map<string, string[]>();
  for (const entry of catalogEntries()) {
    if (!entryMatches(entry, { ...filter, mode: "query" }) || !entry.actor) continue;
    for (const path of familyPrefixes(entry.family))
      members.set(path, [...members.get(path) ?? [], translateMessage(i18n, contentDescriptor(entry.text.name))]);
  }
  return [...members.entries()]
    .filter(([path]) => familyPasses(path, filter))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, names]) => ({
      count: names.length, depth: path.split(".").length - 1, label: familyLabel(path, i18n),
      members: names.slice(0, FAMILY_PREVIEW_MEMBERS).join(", "), path
    }));
};

/** A family passes when one capable entry of the allowed kinds is in it (the validator's family rule). */
export const familyPasses = (path: string, filter: CatalogFilter) =>
  entriesInFamily(path).some(entry => entryMatches(entry, filter));

/** The translated name of a family path: its own name, else the entry its last segment names (`animal.deer`). */
export const familyLabel = (path: string, i18n: I18n | undefined) => {
  const own = FAMILY_NAMES[path];
  if (own) return translateMessage(i18n, own);
  const [kind] = path.split(".");
  const entry = getContentEntry(`${kind}:${path.split(".").at(-1)}`);
  return entry ? translateMessage(i18n, contentDescriptor(entry.text.name)) : humanize(path.split(".").at(-1) ?? path);
};

/** Up to three member names of a family. */
export const familyMembers = (path: string, i18n: I18n | undefined) => entriesInFamily(path)
  .slice(0, FAMILY_PREVIEW_MEMBERS).map(entry => translateMessage(i18n, contentDescriptor(entry.text.name)))
  .join(", ");

/** Nations of the catalog for the nation dropdowns. */
export const catalogNations = (i18n: I18n | undefined) => catalogEntries()
  .filter(entry => entry.kind === "nation" && !entry.retired)
  .map(entry => ({ key: entry.key, label: translateMessage(i18n, contentDescriptor(entry.text.name)) }));
