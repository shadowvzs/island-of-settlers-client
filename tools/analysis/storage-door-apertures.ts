import { mkdir, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { dirname, resolve } from "node:path";
import { DoubleSide, Mesh, MeshBasicMaterial, MeshStandardMaterial, Raycaster, Vector3 } from "three";

import { getBuildingDefinition } from "../../src/render-common/buildings/building-catalog";
import { getRomanBuildingGridMetrics } from "../../src/render-common/buildings/building-grid-metrics";
import type { BuildingSurface } from "../../src/render-common/buildings/building-recipe";
import { leveledBuildingRecipe } from "../../src/render-common/buildings/levels/leveled-building-recipe";
import { DEFAULT_ROMAN_DOOR } from "../../src/render-common/buildings/roman-door-profile";
import type { WorkerNation } from "../../src/render-common/workers/worker-nation";
import { createStorageDoubleDoor, updateStorageDoubleDoor } from "../../src/renderers/three/buildings/storage-double-door";

const output = process.argv[2];
if (!output) throw new Error("Choose a new explicit aperture audit JSON output");
// CPU geometry uses the production dispatch; imported image URLs stay inert (no texture painting).
const assets = registerHooks({ load(url, context, next) {
  if (/\.(png|jpe?g|webp|svg|glb|ktx2)(\?|$)/.test(url))
    return { format: "module", shortCircuit: true, source: `export default ${JSON.stringify(url)};` };
  const loaded = next(url, context);
  if (typeof loaded.source === "string" && loaded.source.includes("import.meta.glob"))
    return { ...loaded, source: loaded.source.replaceAll("import.meta.glob", "(() => ({}))") };
  return loaded;
} });
const { createRomanPartGeometry } = await import("../../src/renderers/three/buildings/roman-building");
assets.deregister();
const nations: WorkerNation[] = ["roman", "viking", "nubian", "japanese", "maya", "persian", "chinese", "indigenous"];
const material = new MeshBasicMaterial({ side: DoubleSide }), ray = new Raycaster();
const leafMaterials = { wood: new MeshStandardMaterial({ side: DoubleSide }),
  cloth: new MeshStandardMaterial({ side: DoubleSide }), iron: new MeshStandardMaterial({ side: DoubleSide }) };
type ApertureRecord = { id: number; nation: WorkerNation; level: 1 | 5; quality: string;
  sections: { sampledWorldWidth: number }[]; [key: string]: unknown };
const direction = new Vector3(0, 0, -1), records: ApertureRecord[] = [];
try {
  for (const id of [0, 29, 39]) for (const nation of nations)
    for (const level of [1, 5] as const) for (const detailed of [true, false]) {
      const definition = getBuildingDefinition(id), scale = getRomanBuildingGridMetrics(definition).scale;
      const recipe = leveledBuildingRecipe(definition, nation, detailed, level);
      const dimensions = recipe.doorDimensions ?? DEFAULT_ROMAN_DOOR;
      const center = recipe.door[0] + dimensions.width / 2;
      const obstacles = recipe.parts.filter(part => !part.stock && !part.doorwayShadow && !part.windowShadow)
        .map(part => {
          const mesh = new Mesh(createRomanPartGeometry(part, detailed), material);
          mesh.userData.part = { shape: part.shape, surface: part.surface, position: part.position, size: part.size };
          return mesh;
        });
      const sections = [];
      const entrance = createStorageDoubleDoor(leafMaterials as Record<BuildingSurface, MeshStandardMaterial>,
        detailed, recipe.door, dimensions, recipe.tentDoor);
      updateStorageDoubleDoor(entrance, [1, 1]); entrance.updateMatrixWorld(true);
      try {
        for (const worldHeight of [.15, .55, .95, 1.075]) {
          const hitsAt = (offset: number) => {
            ray.set(new Vector3(center + offset, recipe.door[1] + worldHeight / scale,
              recipe.door[2] + .18), direction);
            ray.near = 0; ray.far = .50;
            return ray.intersectObjects([...obstacles, entrance], true);
          };
          const blockersAtCenter = hitsAt(0);
          const edge = (sign: number) => {
            if (blockersAtCenter.length) return { offset: 0, blockers: blockersAtCenter.map(hit => hit.object.userData.part) };
            for (let step = 1; step <= 140; step++) {
              const offset = sign * step * .005, hits = hitsAt(offset);
              if (hits.length) return { offset: sign * (step - 1) * .005,
                blockers: hits.map(hit => hit.object.userData.part) };
            }
            return { offset: sign * .7, blockers: [] };
          };
          const left = edge(-1), right = edge(1);
          sections.push({ worldHeight, left, right,
            sampledWorldWidth: (right.offset - left.offset) * scale });
        }
      } finally {
        obstacles.forEach(mesh => mesh.geometry.dispose());
        entrance.traverse(object => { if (object instanceof Mesh) object.geometry.dispose(); });
      }
      records.push({ id, name: definition.name, nation, level, quality: detailed ? "high" : "minimal",
        scale, dimensions, nominalWorldWidth: dimensions.width * scale, door: recipe.door,
        profile: recipe.doorProfile, tent: !!recipe.tentDoor, hidden: !!recipe.hideDoor,
        portalParts: recipe.parts.filter(part => part.persianOpening || part.indigenousEntrance)
          .map(part => ({ shape: part.shape, opening: part.persianOpening ?? part.indigenousEntrance,
            position: part.position, size: part.size })), sections });
    }
} finally { material.dispose(); Object.values(leafMaterials).forEach(surface => surface.dispose()); }
await mkdir(dirname(resolve(output)), { recursive: true });
await writeFile(output, JSON.stringify({ scope: "Read-only actual renderer indexed geometry ray audit. " +
  "5mm model lateral sample; four fixed body heights through doorZ+.18 to doorZ-.32. " +
  "Actual fully open double leaves INCLUDED, static stock omitted, visual shadow backings excluded. " +
  "Not full body/cargo swept-volume acceptance.", records }, null, 2));
console.log(JSON.stringify({ output, records: records.length, groups: [0, 29, 39].flatMap(id =>
  nations.map(nation => ({ id, nation, widths: records.filter(record => record.id === id && record.nation === nation)
    .map(record => ({ level: record.level, quality: record.quality,
      sections: record.sections.map(section => Number(section.sampledWorldWidth.toFixed(4))) })) }))) }));
