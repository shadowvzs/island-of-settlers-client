import type { ColonyNoticeMemory } from "./colony-lost-notice";
import type { ShownHighlight } from "./highlight-store";

/** Map script UI presentation (trigger design §5.2.9, §6.10; lane TRG9). */

/** The attribute of stable anchors on existing controls (bottom bar icons, build tabs, HUD buttons …). */
export const UI_ANCHOR_ATTRIBUTE = "data-ui-anchor";

/** Effects queued while a cinematic or the possessed view hides the HUD are dropped after this long. */
export const DEFERRED_EFFECT_LIMIT_MS = 60_000;

/** Waiting highlights are re-derived from the run state every this many simulation ticks (0.5 s). */
export const WAITING_SYNC_TICKS = 10;

/** One second in milliseconds (highlight `seconds`). */
export const MS_PER_SECOND = 1000;

/** Anchors with a parent opener: when the anchor is not rendered (collapsed panel, phone layout) the ring
 * moves to the declared parent, in this order of prefixes. */
export const UI_ANCHOR_PARENTS: readonly (readonly [prefix: string, parent: string])[] = Object.freeze([
  ["build.tab.", "bottomBar.build"],
  ["menu.", "bottomBar.menu"]
]);

/** Fixed anchors of the HUD (build tabs `build.tab.<category>` and menu entries `menu.<entry>` are derived). */
export const UI_ANCHOR_IDS = Object.freeze([
  "bottomBar.build", "bottomBar.inventory", "bottomBar.map", "bottomBar.menu", "bottomBar.news",
  "hud.gemShop", "hud.messages", "hud.portrait", "hud.quests", "hud.talents",
  "menu.buildings", "menu.market", "menu.overview", "menu.settings", "menu.ships"
] as const);

/** Local storage of the colonies the client last saw, per home island (colony-lost notice, owner round 6). */
export const COLONY_NOTICE_STORAGE_PREFIX = "island-of-settlers.colony-notices.";

/** Expedition ids kept as already announced (bounded; the oldest are forgotten first). */
export const COLONY_NOTICE_ANNOUNCED_LIMIT = 64;

/** The seen colony list is refreshed every this many simulation ticks (5 s). */
export const COLONY_SEEN_SYNC_TICKS = 100;

/** Console prefix of script presentation log lines. */
export const SCRIPT_UI_LOG = "[script ui]";

/** Ring padding around the anchor, gap to the hint bubble and the bubble's viewport margin (px). */
export const HIGHLIGHT_RING_PADDING = 6;
export const HIGHLIGHT_BUBBLE_GAP = 10;
export const HIGHLIGHT_VIEWPORT_MARGIN = 4;

export const NO_SHOWN_HIGHLIGHTS: readonly ShownHighlight[] = Object.freeze([]);

export const EMPTY_COLONY_NOTICE_MEMORY: ColonyNoticeMemory =
  Object.freeze({ announced: [], seen: [] }) as unknown as ColonyNoticeMemory;
