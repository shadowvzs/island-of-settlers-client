import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { catalogEntries } from "@shared/catalog";
import { describe, expect, it } from "vitest";

import allowlistData from "./fixtures/catalog-migration-allowlist.json";
import { contentListKinds, listScannedFiles } from "./helpers/content-literal-scan";

/**
 * Owner 2026-11-11: exactly one content catalog (island-of-settlers-shared/src/catalog). Fails on a second
 * definition list, a checked-in generated copy or a banned legacy export outside it. The few modules still pending a
 * decision are listed in the shrink-only allowlist with their lane; reviewed non-definitions are named below.
 */
const WORKSPACE = resolve(import.meta.dirname, "../..");
const SCANNED_FOLDERS = ["island-of-settlers-client/src", "island-of-settlers-client/tools",
  "island-of-settlers-api/src", "island-of-settlers-shared/src"];
const EXTENSIONS = [".ts", ".tsx", ".json", ".js", ".mjs"];
/** The catalog itself, generated translation catalogs and fixture/review scripts (their inventories are values). */
const EXCLUDED = ["island-of-settlers-shared/src/catalog/", "island-of-settlers-client/src/locales/",
  "island-of-settlers-client/src/campaign-ui-review/", "island-of-settlers-client/tools/bench/",
  "island-of-settlers-client/tools/e2e/", "island-of-settlers-client/tools/analysis/"];
/** A literal holding this many known keys of one kind is a definition list. */
const LIST_THRESHOLD = 5;
/**
 * Nation keys key per-nation art and rule records everywhere; they are type-level names, not content lists. The
 * national commanders (`commander:<nation>`) use the same keys.
 */
const UNSCANNED_KINDS = new Set(["commander", "nation"]);
/**
 * Permanent exceptions (plan Q9, owner answer 31): typed numeric enums for hot code, guarded 1:1 against the
 * catalog codes by content-catalog-codes.test.ts, and TypeScript unions of persisted keys (type-level names).
 */
const TYPED_NAMES: readonly { file: string; kinds: readonly string[] }[] = [
  { file: "island-of-settlers-client/src/shared/world/world-data.ts", kinds: ["plant", "tree"] },
  { file: "island-of-settlers-client/src/render-common/props/prop-mesh-layout.ts", kinds: ["plant", "shell"] },
  { file: "island-of-settlers-client/src/render-common/critters/critter-species.ts", kinds: ["critter"] },
  // Typed value maps keyed by the CRITTER enum: model builders/asset URLs, not content definitions.
  { file: "island-of-settlers-client/src/render-common/critters/critter-models.ts", kinds: ["critter"] },
  { file: "island-of-settlers-client/src/render-common/critters/model/critter-glbs.ts", kinds: ["critter"] },
  { file: "island-of-settlers-client/src/shared/settlement/settlement-types.ts", kinds: ["tree"] },
  { file: "island-of-settlers-client/src/shared/settlement/shore-shell-collection.ts", kinds: ["shell"] }
];
interface WareException { file: string; reason: string }
/**
 * Permanent exceptions (CAT11 per-file decision, CAT0 open question 2): vocabularies that only share names with
 * wares (road tiers, stone materials, building surfaces, motifs). They define no ware.
 */
const SAME_NAMED_VOCABULARIES: readonly WareException[] = [
  { file: "island-of-settlers-client/src/app/map-editor/marble-deposit-helpers.ts",
    reason: "stone material messages (Lingui descriptors)" },
  { file: "island-of-settlers-client/src/app/map-editor/scenario-road-editor.ts", reason: "road tier messages" },
  { file: "island-of-settlers-client/src/app/map-generator/messages.ts",
    reason: "stone material messages (Lingui descriptors)" },
  { file: "island-of-settlers-client/src/render-common/buildings/building-recipe.ts",
    reason: "building surface names (stone, iron, cloth)" },
  { file: "island-of-settlers-client/src/render-common/buildings/indigenous-building-motifs.ts",
    reason: "pigment motif names" },
  { file: "island-of-settlers-client/src/render-common/buildings/nation-drink-signs.ts",
    reason: "facade pictogram strokes" },
  { file: "island-of-settlers-client/src/render-common/props/field-cover-exclusions.ts",
    reason: "render-only crop field kinds (tilled-soil mask), not ware definitions" },
  { file: "island-of-settlers-client/src/render-common/road-appearance.ts", reason: "road tier colours" },
  { file: "island-of-settlers-client/src/renderers/three/buildings/building-surface-paint.ts",
    reason: "building surface palette" },
  { file: "island-of-settlers-client/src/renderers/three/settlement/road-stone-textures.ts",
    reason: "road tier paving textures" },
  { file: "island-of-settlers-client/src/shared/i18n/domain-names-messages.ts",
    reason: "material messages (Lingui descriptors)" },
  { file: "island-of-settlers-client/src/shared/settlement/road-types.ts",
    reason: "road tiers: typed union and per-tier widths" },
  { file: "island-of-settlers-client/tools/assets/production-resource-previews.ts", reason: "crop preview kinds" },
  { file: "island-of-settlers-client/tools/assets/road-previews.ts", reason: "road tier preview rows" }
];
/**
 * Permanent exceptions (CAT11 per-file decision): renderer value maps keyed by ware. The values are geometry,
 * builders or clip names, which the JSON catalog cannot hold; the ware itself is defined only in the catalog.
 */
const WARE_VALUE_MAPS: readonly WareException[] = [
  { file: "island-of-settlers-client/src/render-common/buildings/roman-tavern.ts",
    reason: "bench props of the recruiting wares" },
  { file: "island-of-settlers-client/src/render-common/logistics/cart-cargo-layouts.ts",
    reason: "cart cargo box layout per ware" },
  { file: "island-of-settlers-client/src/render-common/wares/advanced-material-variants.ts",
    reason: "tint and roughness per material ware" },
  { file: "island-of-settlers-client/src/render-common/wares/timber-variant-source.ts",
    reason: "timber piece geometry per ware" },
  { file: "island-of-settlers-client/src/render-common/wares/ware-drink-recipe.ts",
    reason: "mesh builder per drink ware" },
  { file: "island-of-settlers-client/src/render-common/workers/worker-job-actions.ts",
    reason: "pack clip name per tool" },
  { file: "island-of-settlers-client/src/renderers/three/settlement/ware-icon-models.ts",
    reason: "icon looks per ore ware" },
  { file: "island-of-settlers-client/src/renderers/three/settlement/ware-tool-icon-models.ts",
    reason: "icon builder per tool" },
  { file: "island-of-settlers-client/src/renderers/three/settlement/ware-tool-icon-trade-models.ts",
    reason: "icon builder per tool" },
  { file: "island-of-settlers-client/src/renderers/three/three-worker-prop.ts", reason: "hand prop pose per ware" },
  { file: "island-of-settlers-client/tools/review/eai3d-why-panel-capture.ts",
    reason: "review fixture inventory, not a content definition" }
];
const WARE_EXCEPTIONS = [...SAME_NAMED_VOCABULARIES, ...WARE_VALUE_MAPS];
const GENERATED_COPY = [/(^|\/)game-catalog\.json$/, /assets\/(buildings\/[a-z]+|nations)\/catalog\.json$/];
/** Legacy export names banned once their lane has landed (plan §13.1b). */
const BANNED_EXPORTS: readonly { lane: string; name: string }[] = [
  { lane: "CAT1", name: "WARES" }, { lane: "CAT1", name: "UNCOUNTABLE_WARES" }, { lane: "CAT1", name: "WARE_BOX_UNITS" },
  ...["ROAD_DECORATION_CONTENT", "ADDITIONAL_ROAD_DECORATION_CONTENT", "CLIMBER_ROAD_DECORATION_CONTENT",
    "ROMAN_COLUMN_CONTENT", "RELEASED_ROAD_DECORATION_ITEM_IDS", "RELEASED_ORNAMENTAL_PLANT_ITEM_IDS",
    "PLAYER_ITEM_DEFINITIONS", "PLANT_NAMES", "GEM_SHOP_OFFERS", "GEM_SHOP_TOOL_WARES", "GEM_SHOP_MILITARY_BUNDLES",
    "GEM_SHOP_RESOURCE_BUNDLES", "CATALOG"].map(name => ({ lane: "CAT2", name })),
  ...["JOB_MESSAGE_KEYS", "JOB_MESSAGE_KEY_LOOKUP"]
    .map(name => ({ lane: "CAT5", name })),
  ...["TRADE_WARE_VALUES", "TRADE_PROTECTED_FLOORS", "QUEST_WARE_BATCH", "STARTER_STOCK", "SAWMILL_RECIPES",
    "RESOURCE_TIERS", "RESOURCE_TIER_MINIMUM_LEVEL", "LEVEL_STEPS", "TALENTS"].map(name => ({ lane: "CAT10", name })),
  { lane: "CAT11", name: "COLONY_ADVANCED_EXPORTS" }
];
interface PendingEntry { file: string; kinds?: readonly string[]; lane: string }
const allowlist = allowlistData as { contentLists: PendingEntry[]; generatedCopies: PendingEntry[] };
const ALL_FILES = SCANNED_FOLDERS.flatMap(folder => listScannedFiles(WORKSPACE, folder, EXTENSIONS, EXCLUDED));

const keysByKind = () => {
  const keys = new Map<string, Set<string>>();
  for (const entry of catalogEntries()) {
    if (UNSCANNED_KINDS.has(entry.kind)) continue;
    const set = keys.get(entry.kind) ?? new Set<string>();
    keys.set(entry.kind, set.add(entry.key));
  }
  return keys;
};

const read = (file: string) => readFileSync(resolve(WORKSPACE, file), "utf8");
const listKey = (file: string, kind: string) => `${kind} ${file}`;

describe("one content catalog", () => {
  it("finds no content definition list outside the catalog except pending allowlisted ones", () => {
    const keys = keysByKind();
    const found = ALL_FILES.flatMap(file => contentListKinds(read(file), keys, LIST_THRESHOLD)
      .map(kind => listKey(file, kind)));
    const pending = allowlist.contentLists.flatMap(({ file, kinds = [] }) => kinds.map(kind => listKey(file, kind)));
    const typed = [...TYPED_NAMES.flatMap(({ file, kinds }) => kinds.map(kind => listKey(file, kind))),
      ...WARE_EXCEPTIONS.map(({ file }) => listKey(file, "ware"))];
    expect(typed.filter(entry => !found.includes(entry)), "permanent exceptions no longer listed").toEqual([]);
    expect(found.filter(entry => !pending.includes(entry) && !typed.includes(entry)), "new definition lists")
      .toEqual([]);
    expect(pending.filter(entry => !found.includes(entry)), "migrated: remove from the allowlist").toEqual([]);
  });

  it("checks in no generated copy of catalog data except pending allowlisted ones", () => {
    const copies = ALL_FILES.concat(listScannedFiles(WORKSPACE, "island-of-settlers-client/assets", [".json"], []))
      .filter(file => GENERATED_COPY.some(pattern => pattern.test(file)));
    const pending = allowlist.generatedCopies.map(({ file }) => file);
    expect(copies.filter(file => !pending.includes(file))).toEqual([]);
    expect(pending.filter(file => !copies.includes(file)), "removed: shrink the allowlist").toEqual([]);
  });

  it("exports no banned legacy definition name", () => {
    const offenders = BANNED_EXPORTS.flatMap(({ name }) => {
      const pattern = new RegExp(`export\\s+(const|let|var|function|type|interface)\\s+${name}\\b`);
      return ALL_FILES.filter(file => !file.endsWith(".json") && pattern.test(read(file)))
        .map(file => `${name} ${file}`);
    });
    expect(offenders).toEqual([]);
  });

  it("assigns every pending entry to a catalog lane", () => {
    const lanes = [...allowlist.contentLists, ...allowlist.generatedCopies].map(({ lane }) => lane);
    expect(lanes.filter(lane => !/^CAT\d+$/.test(lane))).toEqual([]);
  });
});
