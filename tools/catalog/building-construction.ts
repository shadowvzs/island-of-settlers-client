import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { Box3, MeshStandardMaterial } from "three";
import { createServer } from "vite";

/**
 * Measures the construction inputs of every building from its High, base-level Roman model (occupied grid
 * footprint, model height, static triangles) and writes `data/buildings/<key>/construction.json` with the unified
 * cost (catalog README, "Construction cost rule"). Fixed entries (free headquarters, all-tier monument) and
 * buildings with authored per-nation receipts keep their authored costs; only the inputs are re-measured.
 * Run after building model changes: npm run building-construction (part of npm run building-assets).
 * `--measure` prints the inputs as JSON without writing.
 */
const DATA = resolve(import.meta.dirname, "../../../island-of-settlers-shared/src/catalog/data/buildings");
const HEIGHT_DECIMALS = 100;

const server = await createServer({ appType: "custom", logLevel: "error", server: { hmr: false, middlewareMode: true } });
try {
  const load = (path: string) => server.ssrLoadModule(path);
  const { buildingEntry } = await load("@shared/catalog");
  const { unifiedConstructionCost } = await load("@shared/catalog/building-data/construction-formula");
  const { BUILDING_CATALOG } = await load("/src/render-common/buildings/building-catalog.ts");
  const { leveledBuildingRecipe } = await load("/src/render-common/buildings/levels/leveled-building-recipe.ts");
  const { createRomanBuilding } = await load("/src/renderers/three/buildings/roman-building.ts");
  const { NATION_SURFACES, ROMAN_SURFACE_COLOURS } = await load("/src/renderers/three/buildings/building-surface-paint.ts");
  /** One plain material per surface the model may use (geometry only; the model merges parts per material). */
  const plainMaterials = (parts: readonly { surface: string }[]) => Object.fromEntries([...new Set([
    ...Object.keys(ROMAN_SURFACE_COLOURS), ...Object.keys(NATION_SURFACES.roman ?? {}),
    ...parts.map(part => part.surface)])].map(surface => [surface, new MeshStandardMaterial()]));
  const measured: Record<string, unknown> = {};
  for (const definition of BUILDING_CATALOG) {
    const key = buildingEntry(definition.id).key as string;
    const file = join(DATA, key, "construction.json");
    const previous = JSON.parse(readFileSync(file, "utf8")) as { cost: unknown; fixed?: true; nations?: unknown };
    if (previous.fixed) continue;
    const recipe = leveledBuildingRecipe(definition, "roman", true, 1);
    const materials = plainMaterials(recipe.parts);
    const model = createRomanBuilding(definition, materials, true, recipe, "roman");
    model.fitToGrid();
    model.root.updateMatrixWorld(true);
    const height = Math.round(new Box3().setFromObject(model.root).max.y * HEIGHT_DECIMALS) / HEIGHT_DECIMALS;
    const inputs = { cells: [...definition.gridFootprint], height, triangles: model.triangles(false) };
    model.dispose();
    for (const material of Object.values(materials)) material.dispose();
    measured[key] = inputs;
    if (process.argv.includes("--measure")) continue;
    mkdirSync(join(DATA, key), { recursive: true });
    // Authored per-nation receipts keep their cost; only buildings without them take the unified default.
    const stored = previous.nations ? { cost: previous.cost, inputs, nations: previous.nations }
      : { cost: unifiedConstructionCost(inputs), inputs };
    writeFileSync(file, `${JSON.stringify(stored, null, 2)}\n`);
  }
  if (process.argv.includes("--measure")) console.log(JSON.stringify(measured));
} finally {
  await server.close();
}
