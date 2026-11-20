import { writeFileSync } from "node:fs";
import { Box3, Vector3 } from "three";
import { createServer } from "vite";

import { getBuildingDefinition } from "../../src/render-common/buildings/building-catalog";
import { createNationBuildingRecipe } from "../../src/render-common/buildings/nation-building-recipe";
import { unsupportedParts } from "../../tests/helpers/recipe-supports";
import { resourcesPath } from "../bench/resources-path";

const rows = [];
const server = await createServer({ appType: "custom", server: { hmr: false, middlewareMode: true } });
try {
const { createRomanPartGeometry } = await server.ssrLoadModule("/src/renderers/three/buildings/roman-building.ts") as
  typeof import("../../src/renderers/three/buildings/roman-building");
for (const [nation, id] of [["roman", 16], ["japanese", 17], ["japanese", 20]] as const) for (const detailed of [true, false]) {
  const recipe = createNationBuildingRecipe(getBuildingDefinition(id), nation, detailed);
  const bounds = recipe.parts.map(part => {
    const geometry = createRomanPartGeometry(part, detailed);
    try { geometry.computeBoundingBox(); return geometry.boundingBox!.clone(); }
    finally { geometry.dispose(); }
  });
  const connected = new Set<number>(), queue: number[] = [];
  bounds.forEach((box, index) => { if (box.min.y <= .001) { connected.add(index); queue.push(index); } });
  while (queue.length) {
    const current = bounds[queue.pop()!]!.clone().expandByScalar(.012);
    bounds.forEach((box, index) => {
      if (connected.has(index) || !current.intersectsBox(box)) return;
      connected.add(index); queue.push(index);
    });
  }
  const gap = (a: Box3, b: Box3) => new Vector3(
    Math.max(0, a.min.x - b.max.x, b.min.x - a.max.x),
    Math.max(0, a.min.y - b.max.y, b.min.y - a.max.y),
    Math.max(0, a.min.z - b.max.z, b.min.z - a.max.z)).length();
  const item = (index: number) => ({ index, part: recipe.parts[index]!,
    bounds: { min: bounds[index]!.min.toArray(), max: bounds[index]!.max.toArray() } });
  const unsupported = bounds.flatMap((box, index) => {
    if (connected.has(index)) return [];
    const nearest = [...connected].map(other => ({ index: other, gap: gap(box, bounds[other]!) }))
      .sort((a, b) => a.gap - b.gap)[0]!;
    return [{ ...item(index), nearestConnected: item(nearest.index), gap: nearest.gap }];
  });
  rows.push({ nation, id, detailed, legacyUnsupported: unsupportedParts(recipe), actualGeometryBoxUnsupported: unsupported });
}
writeFileSync(resourcesPath("project-reviews", "building-assets-sync-2026-11-04", "full-b", "support-diagnostics.json"),
  JSON.stringify(rows, null, 2));
console.log(JSON.stringify(rows.map(row => ({ nation: row.nation, id: row.id, detailed: row.detailed,
  legacy: row.legacyUnsupported.length, actual: row.actualGeometryBoxUnsupported.map(part => ({
    shape: part.part.shape, position: part.part.position, gap: part.gap,
    supportShape: part.nearestConnected.part.shape, supportPosition: part.nearestConnected.part.position
  })) })), null, 2));
} finally { await server.close(); }
