import { createHash } from "node:crypto";
import { type BufferAttribute, type BufferGeometry, InterleavedBufferAttribute, type Mesh, type Object3D } from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BUILDING_LEVELS } from "../src/render-common/buildings/levels/building-level";
import { WORKER_NATIONS } from "../src/render-common/workers/worker-appearance";
import type { WorkerNation } from "../src/render-common/workers/worker-unit";
import { createPlainBuildingMaterials, stubPaintCanvas } from "./helpers/building-materials";

/** FULL=1: every nation and level (minutes); by default three nations at levels 1 and 5. */
const FULL = process.env.FULL === "1";
const LEVELS = FULL ? BUILDING_LEVELS : ([1, 5] as const);
const NATIONS: readonly WorkerNation[] = FULL ? WORKER_NATIONS : ["roman", "nubian", "chinese"];

/** A fresh module graph: its own recipe cache, like the worker or the main thread. */
const loadGraph = async () => {
  vi.resetModules();
  const [catalog, recipes, models, roman, packing] = await Promise.all([
    import("../src/render-common/buildings/building-catalog"),
    import("../src/render-common/buildings/levels/leveled-building-recipe"),
    import("../src/renderers/three/buildings/nation-building"),
    import("../src/renderers/three/buildings/roman-building"),
    import("../src/renderers/three/buildings/building-prepared-geometry")
  ]);
  return { catalog, models, packing, recipes, roman };
};
type Graph = Awaited<ReturnType<typeof loadGraph>>;

/** Every object of a posted recipe must survive structured cloning unchanged: plain data only. */
const nonPlainPaths = (value: unknown, path = "recipe"): string[] => {
  if (typeof value === "function") return [path];
  if (value === null || typeof value !== "object") return [];
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== Array.prototype) return [path];
  return Object.entries(value).flatMap(([key, child]) => nonPlainPaths(child, `${path}.${key}`));
};

const attributeBytes = (attribute: BufferAttribute | InterleavedBufferAttribute) => {
  const array = attribute instanceof InterleavedBufferAttribute ? attribute.data.array : attribute.array;
  return Buffer.from(array.buffer, array.byteOffset, array.byteLength);
};

/** Random object ids (serialized catapult bundles) differ between any two builds; functions are code. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const stableUserData = (_: string, value: unknown) => {
  if (typeof value === "string" && UUID.test(value)) return "uuid";
  return typeof value === "function" ? "fn" : value;
};

/** Structure, transforms, materials (by name and type), user data and every attribute byte. */
const modelFingerprint = (root: Object3D) => {
  const hash = createHash("sha256");
  let meshes = 0;
  root.traverse(object => {
    hash.update(`${object.type}|${object.name}|${object.visible}|${object.matrix.elements.join(",")}|`);
    hash.update(JSON.stringify(object.userData, stableUserData) ?? "");
    if (!(object as Mesh).isMesh) return;
    meshes++;
    const materials = [(object as Mesh).material].flat();
    hash.update(materials.map(material => `${material.type}:${material.name}`).join(","));
    const geometry = (object as Mesh).geometry as BufferGeometry;
    for (const [name, attribute] of Object.entries(geometry.attributes)) {
      hash.update(`${name}:${attribute.itemSize}:${attribute.normalized}`);
      hash.update(attributeBytes(attribute));
    }
    if (geometry.index) hash.update(attributeBytes(geometry.index));
    hash.update(JSON.stringify(geometry.groups) + JSON.stringify(geometry.drawRange));
  });
  return `${meshes}:${hash.digest("hex")}`;
};

/** Keys whose fingerprint differs from the native build. */
const mismatches = (built: string[], native: string[]) => built.flatMap((print, index) =>
  print === native[index] ? [] : [print.split(":").slice(0, 4).join(":")]);

const variantsOf = (graph: Graph) => graph.catalog.BUILDING_CATALOG.flatMap(definition =>
  NATIONS.flatMap(nation => LEVELS.flatMap(level => [true, false].map(detailed =>
    ({ definition, detailed, level, nation })))));

type Prepared = (key: string) => ReturnType<Graph["packing"]["unpackPartGroups"]> | undefined;
const fingerprints = (graph: Graph, prepared: Prepared = () => undefined) => {
  const materials = createPlainBuildingMaterials();
  return graph.catalog.BUILDING_CATALOG.flatMap(definition => NATIONS.flatMap(nation =>
    LEVELS.flatMap(level => [true, false].map(detailed => {
      const key = graph.recipes.leveledRecipeKey(definition.id, nation, level, detailed);
      const model = graph.models.createNationBuilding(definition, materials, nation, detailed, level, prepared(key));
      model.fitToGrid();
      model.root.updateMatrixWorld(true);
      const print = `${definition.id}:${nation}:${level}:${detailed}:${modelFingerprint(model.root)}`;
      model.dispose();
      return print;
    }))));
};

/** Recipes and merged groups generated in one module graph (the worker), cloned like a posted reply. */
const workerReplies = async () => {
  const worker = await loadGraph();
  return variantsOf(worker).map(({ definition, detailed, level, nation }) => {
    const leveled = worker.recipes.leveledRecipeEntry(definition, nation, detailed, level);
    const { packed } = worker.packing.packPartGroups(worker.roman.prepareMergedPartGroups(leveled.recipe, detailed));
    return [worker.recipes.leveledRecipeKey(definition.id, nation, level, detailed),
      structuredClone(leveled), structuredClone(packed)] as const;
  });
};

describe("building recipe worker parity", () => {
  beforeEach(stubPaintCanvas);

  it("posts plain recipe data only", async () => {
    const worker = await loadGraph();
    const failures = variantsOf(worker).flatMap(({ definition, detailed, level, nation }) =>
      nonPlainPaths(worker.recipes.leveledRecipeEntry(definition, nation, detailed, level))
        .map(path => `${definition.id}:${nation}:${level}:${detailed} ${path}`));
    expect(failures.slice(0, 10)).toEqual([]);
  }, 300_000);

  it("builds byte-identical models from adopted recipes and prepared geometry", async () => {
    const replies = await workerReplies();
    const native = fingerprints(await loadGraph());
    const adopted = await loadGraph();
    for (const [key, leveled] of replies) adopted.recipes.seedLeveledRecipe(key, leveled);
    expect(mismatches(fingerprints(adopted), native).slice(0, 20)).toEqual([]);
    // Mixed: the main thread generated the detailed recipes itself (navigation), the worker the simple ones.
    const mixed = await loadGraph();
    for (const [key, leveled] of replies) if (key.endsWith(":0")) mixed.recipes.seedLeveledRecipe(key, leveled);
    expect(mismatches(fingerprints(mixed), native).slice(0, 20)).toEqual([]);
    // Prepared: the worker also merged every model's part groups (posted typed arrays).
    const prepared = await loadGraph();
    for (const [key, leveled] of replies) prepared.recipes.seedLeveledRecipe(key, leveled);
    const groups = new Map(replies.map(([key, , packed]) => [key, packed]));
    const unpack = (key: string) => prepared.packing.unpackPartGroups(groups.get(key)!);
    expect(mismatches(fingerprints(prepared, unpack), native).slice(0, 20)).toEqual([]);
    // Every model hashed real meshes (authored monuments of other nations load asynchronously).
    expect(native.filter(print => print.split(":")[4] === "0" && !print.startsWith("7:"))).toEqual([]);
  }, 900_000);
});
