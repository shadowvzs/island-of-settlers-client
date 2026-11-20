import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { BUILDING_CATALOG } from "../../src/render-common/buildings/building-catalog";
import { leveledBuildingRecipe } from "../../src/render-common/buildings/levels/leveled-building-recipe";
import { getNationBuildingDefinition } from "../../src/render-common/buildings/nation-building-text";
import { GALLERY_NATIONS } from "../bench/building-gallery-plan";
import { resourcesPath } from "../bench/resources-path";

const stage = process.argv[2] ?? "before";
assert(/^[a-z0-9-]+$/.test(stage));
const output = resourcesPath("project-reviews", "building-assets-sync-2026-11-04", "full-b", `recipe-hashes-${stage}.json`);
assert(!existsSync(output), "Preserve prior revision snapshots");
const hashes: Record<string, string> = {};
for (const nation of GALLERY_NATIONS) for (const detailed of [true, false]) for (const { id } of BUILDING_CATALOG)
  for (const level of [1, 2, 3, 4, 5] as const) {
    const recipe = leveledBuildingRecipe(getNationBuildingDefinition(id, nation), nation, detailed, level);
    hashes[`${nation}-${id}-${detailed ? "high" : "minimal"}-l${level}`] =
      createHash("sha256").update(JSON.stringify(recipe)).digest("hex");
  }
let changed: string[] = [];
const beforePath = resourcesPath("project-reviews", "building-assets-sync-2026-11-04", "full-b", "recipe-hashes-before.json");
if (stage !== "before" && existsSync(beforePath)) {
  const before = JSON.parse(readFileSync(beforePath, "utf8")).hashes as Record<string, string>;
  changed = Object.keys(hashes).filter(key => hashes[key] !== before[key]);
}
writeFileSync(output, JSON.stringify({ stage, generatedAt: new Date().toISOString(), hashes, changed,
  policy: "Canonical nation/type/LOD/level recipe data only. Unchanged recipe hashes require unchanged renderer/material code before reusing earlier pixels." }, null, 2));
console.log(JSON.stringify({ output, variants: Object.keys(hashes).length, changed: changed.length, keys: changed }));
