import {
  SCRIPT_LINK_ITEM_PARAM, SCRIPT_LINK_PATH_PARAM, SCRIPT_LINK_TAB_PARAM, SCRIPT_LINK_TABS, type ScriptLinkTab
} from "./constants";
import { type NodePath, parseIssuePath } from "./paths";

/**
 * The Script window deep link: `editor.html?script=triggers&scriptItem=trigger-3&scriptPath=conditions.of[0].a` opens
 * the window on a tab with one trigger, quest, variable or actor selected (the campaign Check panel links script
 * issues this way). `path` is the field inside the item, kept for the item's own issue rows.
 */
export interface ScriptDeepLink {
  /** The id of the trigger, quest, variable or actor to select. */
  itemId?: string;
  /** The issue path inside the item (`conditions.of[0].a`). */
  path?: string;
  tab: ScriptLinkTab;
}

const isLinkTab = (value: string | null): value is ScriptLinkTab =>
  value !== null && (SCRIPT_LINK_TABS as readonly string[]).includes(value);

/** The deep link of a page query, or null when it names no (known) Script tab. */
export const readScriptDeepLink = (search: string): ScriptDeepLink | null => {
  const query = new URLSearchParams(search);
  const tab = query.get(SCRIPT_LINK_TAB_PARAM);
  if (!isLinkTab(tab)) return null;
  const itemId = query.get(SCRIPT_LINK_ITEM_PARAM), path = query.get(SCRIPT_LINK_PATH_PARAM);
  return { tab, ...(itemId ? { itemId } : {}), ...(path ? { path } : {}) };
};

/** `pageUrl` with the deep link's query parameters added (other parameters are kept). */
export const withScriptDeepLink = (pageUrl: string, link: ScriptDeepLink) => {
  const url = new URL(pageUrl);
  url.searchParams.set(SCRIPT_LINK_TAB_PARAM, link.tab);
  if (link.itemId) url.searchParams.set(SCRIPT_LINK_ITEM_PARAM, link.itemId);
  if (link.path) url.searchParams.set(SCRIPT_LINK_PATH_PARAM, link.path);
  return url.href;
};

/**
 * The field path a link names inside the shown item, for the row and slot highlight; null when the link is for
 * another tab or item, or names no field.
 */
export const linkedFieldPath = (
  link: ScriptDeepLink | null, tab: ScriptLinkTab, itemId: string
): NodePath | null => {
  if (!link?.path || link.tab !== tab || link.itemId !== itemId) return null;
  const path = parseIssuePath(link.path);
  return path.length ? path : null;
};
