import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Box3, Matrix4, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { getBuildingDefinition, RETIRED_BUILDING_IDS } from "../src/render-common/buildings/building-catalog";
import { getRomanBuildingWorldSizing } from "../src/render-common/buildings/building-world-sizing";
import { MONUMENT_ASSETS, MONUMENT_PLOT, MONUMENT_TYPE_ID } from "../src/render-common/buildings/monument-definition";
import { buildingUnlockLevel } from "../src/shared/progression/building-unlocks";

const folder = new URL("../assets/monuments/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", folder), "utf8"));
interface Node { matrix?: number[]; children?: number[]; mesh?: number; name?: string }
interface Primitive { attributes: { POSITION: number }; indices?: number }
interface Accessor { min?: number[]; max?: number[]; count: number }

/** Independently inspect actual active-scene binary GLBs without decoding their embedded images. */
const inspect = (bytes: Buffer) => {
  expect(bytes.readUInt32LE(0)).toBe(0x46546c67);
  expect(bytes.readUInt32LE(8)).toBe(bytes.length);
  const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  const bounds = new Box3(), entrances: Vector3[] = [];
  let triangles = 0;
  const walk = (index: number, parent: Matrix4) => {
    const node: Node = json.nodes[index], world = parent.clone().multiply(new Matrix4().fromArray(node.matrix ??
      [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]));
    if (node.name === "Anchor.RoadEntrance") entrances.push(new Vector3().setFromMatrixPosition(world));
    if (node.mesh !== undefined) for (const part of json.meshes[node.mesh].primitives as Primitive[]) {
      const position: Accessor = json.accessors[part.attributes.POSITION];
      triangles += (part.indices === undefined ? position.count : json.accessors[part.indices].count) / 3;
      for (const x of [position.min![0]!, position.max![0]!]) for (const y of [position.min![1]!, position.max![1]!])
        for (const z of [position.min![2]!, position.max![2]!]) bounds.expandByPoint(new Vector3(x, y, z).applyMatrix4(world));
    }
    node.children?.forEach(child => walk(child, world));
  };
  json.scenes[json.scene ?? 0].nodes.forEach((index: number) => walk(index, new Matrix4()));
  return { bounds, triangles, entrances };
};

describe("standalone national monument assets", () => {
  it("adds a max-level monument without reusing retired Temple or assigning production", () => {
    const definition = getBuildingDefinition(MONUMENT_TYPE_ID), sizing = getRomanBuildingWorldSizing(definition);
    // ID 7 is the active Monument identity; the retired Temple no longer owns it
    // (building-workyards-and-functional-categories-plan-2026-11-01.md).
    expect(RETIRED_BUILDING_IDS.has(7)).toBe(false);
    expect(definition.name).toBe("Monument"); expect(definition.outputStorage).toBeUndefined();
    // The rebalanced placement table (041bde88c) unlocks the Monument at level 30, not the old 50.
    expect(buildingUnlockLevel(MONUMENT_TYPE_ID)).toBe(30);
    expect(sizing.scale).toBe(1); expect(sizing.cells).toEqual(MONUMENT_PLOT);
  });
  for (const [nation, specification] of Object.entries(MONUMENT_ASSETS).filter(([nation]) =>
    manifest.buildings.some((item: { nation: string }) => item.nation === nation))) it.each(["high", "minimal"])(`${nation} %s retains its supplied mesh, bounds and +Z approach`, quality => {
    const bytes = readFileSync(fileURLToPath(new URL(`${nation}-${quality}.glb`, folder)));
    const original = manifest.buildings.find((item: { nation: string }) => item.nation === nation)[quality === "high" ? "main" : "distant"];
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(original.sha256);
    const measured = inspect(bytes);
    expect(measured.triangles).toBe(original.triangles);
    expect(bytes.length).toBeLessThan(10_000_000);
    for (const [axis, span] of [["x", MONUMENT_PLOT[0]], ["z", MONUMENT_PLOT[1]]] as const) {
      expect(measured.bounds.min[axis]).toBeGreaterThan(-span / 2);
      expect(measured.bounds.max[axis]).toBeLessThan(span / 2);
    }
    expect(measured.bounds.min.y).toBeGreaterThanOrEqual(-.161);
    expect(measured.bounds.max.y).toBeCloseTo(nation === "japanese" && quality === "high" ? 11.86 : specification.height, 4);
    expect(measured.entrances).toHaveLength(1);
    expect(measured.entrances[0]!.z).toBeGreaterThan(3);
  });
});
