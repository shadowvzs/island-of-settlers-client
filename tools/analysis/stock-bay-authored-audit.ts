import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { BUILDING_CATALOG } from "../../src/render-common/buildings/building-catalog";
import { getRomanPartBounds } from "../../src/render-common/buildings/building-recipe-fit";
import { BUILDING_LEVELS } from "../../src/render-common/buildings/levels/building-level";
import { createNationBuildingRecipe } from "../../src/render-common/buildings/nation-building-recipe";
import type { WorkerNation } from "../../src/render-common/workers/worker-nation";

/** Read-only authored-layout inventory; never runs the evolving compaction service or mutates stock metadata. */
const nations: WorkerNation[] = ["roman", "viking", "japanese", "nubian", "chinese", "persian", "maya", "indigenous"];
const rows: unknown[] = [];
for (const nation of nations) for (const level of BUILDING_LEVELS) for (const detailed of [true, false]) {
  for (const definition of BUILDING_CATALOG) {
    const recipe = createNationBuildingRecipe(definition, nation, detailed, level);
    const grouped = new Map<string, typeof recipe.parts>();
    recipe.parts.forEach(part => {
      if (!part.stock) return;
      const key = `${part.stock.kind ?? "output"}:${part.stock.ware}:${part.stock.slot}`;
      const pieces = grouped.get(key) ?? []; pieces.push(part); grouped.set(key, pieces);
    });
    const permanent = recipe.parts.flatMap((part, index) => part.stock ? [] : [{ part, index, box: getRomanPartBounds(part) }]);
    const slots = [...grouped.values()].map(parts => {
      const boxes = parts.map(part => getRomanPartBounds(part)), stock = parts[0]!.stock!;
      const min = [0, 1, 2].map(axis => Math.min(...boxes.map(box => box.min[axis]!)));
      const max = [0, 1, 2].map(axis => Math.max(...boxes.map(box => box.max[axis]!)));
      const supports = permanent.filter(({ box }) => Math.abs(box.max[1] - min[1]!) <= .045 &&
        box.max[0] > min[0]! && box.min[0] < max[0]! && box.max[2] > min[2]! && box.min[2] < max[2]!);
      return { ...stock, min, max, centre: min.map((value, axis) => (value + max[axis]!) / 2),
        yaw: parts.reduce((best, part) => part.size.reduce((a, b) => a * b, 1) >
          best.size.reduce((a, b) => a * b, 1) ? part : best).rotation?.[1] ?? 0,
        ground: min[1]! <= .045,
        supports: supports.map(({ box, index, part }) => ({ part: index, shape: part.shape,
          surface: part.surface, min: box.min, max: box.max })) };
    });
    rows.push({ nation, type: definition.id, name: definition.name, level,
      quality: detailed ? "high" : "minimal", slots });
  }
  console.log(`${nation}/L${level}/${detailed ? "high" : "minimal"}`);
}
const folder = resolve("../resources/project-reviews/stock-bay-authored-audit-2026-11-03");
mkdirSync(folder, { recursive: true });
writeFileSync(resolve(folder, "authored-layouts.json"), JSON.stringify({
  status: "Read-only authored bounds/support candidates; not verified compact packing or reachability", rows }));
console.log(`Audited ${rows.length} recipes into ${folder}`);
