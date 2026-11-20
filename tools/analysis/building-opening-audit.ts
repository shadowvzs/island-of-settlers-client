import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { BUILDING_CATALOG } from "../../src/render-common/buildings/building-catalog";
import { BUILDING_LEVELS } from "../../src/render-common/buildings/levels/building-level";
import { leveledBuildingRecipe } from "../../src/render-common/buildings/levels/leveled-building-recipe";
import { GALLERY_NATIONS } from "../bench/building-gallery-plan";
import { resourcesPath } from "../bench/resources-path";

const label = process.argv[2] ?? "current";
if (!/^[a-z0-9-]+$/.test(label)) throw new Error("Use a simple audit label");
const output = resourcesPath("project-reviews", "all-nation-openings-2026-11-04");
mkdirSync(output, { recursive: true });
const rows = [];
for (const nation of GALLERY_NATIONS) for (const detailed of [true, false])
  for (const definition of BUILDING_CATALOG) for (const level of BUILDING_LEVELS) {
    const recipe = leveledBuildingRecipe(definition, nation, detailed, level);
    assert(recipe.parts.every(part => part.shape !== "window-shadow" || part.windowShadow),
      `${nation}/${definition.id}/${level}: authored opening escaped canonical finalization`);
    const shadows = recipe.parts.filter(part => part.windowShadow);
    assert(shadows.every(part => Math.min(...part.size) <= .001),
      `${nation}/${definition.id}/${level}: opening remained a volumetric box`);
    const dark = recipe.parts.filter(part => part.surface === "dark" && !part.windowShadow && !part.stock);
    rows.push({ nation, detailed, id: definition.id, name: definition.name, level,
      shadows: shadows.map(part => ({ position: part.position, size: part.size, stage: part.stage,
        decorative: part.windowShadowDecorative ?? false, doorway: part.doorwayShadow ?? false })),
      opaqueDark: dark.map(part => ({ shape: part.shape, position: part.position, size: part.size,
        stage: part.stage, mechanism: part.catapultPart, rotation: part.rotation })) });
  }
const summary = { label, variants: rows.length, shadowPlanes: rows.reduce((sum, row) => sum + row.shadows.length, 0),
  remainingDarkParts: rows.reduce((sum, row) => sum + row.opaqueDark.length, 0),
  policy: "Author semantics classify openings; dark structural floors, metal, fuel, vessels and textiles remain opaque.",
  rows };
writeFileSync(resolve(output, `${label}.json`), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ label, variants: summary.variants, shadowPlanes: summary.shadowPlanes,
  remainingDarkParts: summary.remainingDarkParts, output }));
