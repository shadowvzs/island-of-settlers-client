import { Vector3 } from "three";
import { expect, it } from "vitest";

import type { BuildingPart } from "../src/render-common/buildings/building-recipe";
import { BUILDING_CATALOG } from "../src/render-common/buildings/building-catalog";
import { getRomanPartBounds } from "../src/render-common/buildings/building-recipe-fit";
import { createNationBuildingRecipe } from "../src/render-common/buildings/nation-building-recipe";
import { createMayaThatchRoof } from "../src/renderers/three/buildings/maya-thatch-roof";

const HARBOUR_ID = 39;
const ROUND_MASONRY = ["stone-arc", "ring", "cylinder"];
const STONE_SURFACES = ["stone", "plaster", "cut-stone"];

interface TowerBody { outerRadius: number; radius: number; span: number; x: number; z: number }

/** The tall round masonry drum kept from the Roman shore lantern, read back from the Maya plan. */
const roundTowerOf = (parts: readonly BuildingPart[]): TowerBody => {
  const groups = new Map<string, BuildingPart[]>();
  for (const part of parts) {
    if (part.stock || !ROUND_MASONRY.includes(part.shape) ||
      !STONE_SURFACES.includes(part.surface)) continue;
    const key = `${part.position[0].toFixed(2)}/${part.position[2].toFixed(2)}`;
    const group = groups.get(key) ?? [];
    group.push(part);
    groups.set(key, group);
  }
  const towers = [...groups.values()].map(group => {
    const walls = group.filter(part => part.size[1] >= .12);
    const radii = walls.map(part => Math.max(part.size[0], part.size[2]) / 2 *
      Math.min(part.topScale?.[0] ?? 1, part.topScale?.[2] ?? 1));
    return {
      outerRadius: Math.max(...radii),
      radius: Math.min(...radii),
      span: Math.max(...group.map(part => part.position[1] + part.size[1] / 2)) -
        Math.min(...group.map(part => part.position[1] - part.size[1] / 2)),
      x: group[0]!.position[0],
      z: group[0]!.position[2]
    };
  }).filter(tower => tower.radius > .25 && tower.span > .8);
  expect(towers, "the harbour keeps exactly one round lantern drum").toHaveLength(1);
  return towers[0]!;
};

/** Same scale → rotation → translation order the building mesh applies to a unit recipe part. */
const roofWorldPoint = (part: BuildingPart, x: number, y: number, z: number) => {
  const point = new Vector3(x * part.size[0], y * part.size[1], z * part.size[2]);
  if (part.rotation) {
    point.applyAxisAngle(new Vector3(1, 0, 0), part.rotation[0]);
    point.applyAxisAngle(new Vector3(0, 1, 0), part.rotation[1]);
    point.applyAxisAngle(new Vector3(0, 0, 1), part.rotation[2]);
  }
  return point.add(new Vector3(...part.position));
};

const thatchRoofs = (parts: readonly BuildingPart[]) =>
  parts.filter(part => part.shape === "occupation-roof" && part.plantRoofStyle !== undefined);

it.each([true, false])("keeps Maya harbour thatch off the round lantern drum (%s)", detailed => {
  const definition = BUILDING_CATALOG.find(entry => entry.id === HARBOUR_ID)!;
  for (const level of [1, 5] as const) {
    const parts = createNationBuildingRecipe(definition, "maya", detailed, level).parts;
    const tower = roundTowerOf(parts);
    expect(parts.filter(part => part.shape === "roof-infill" && part.occupationRoof === "hip"),
      `${detailed}/L${level}: hip thatch needs no bare under-panel`).toHaveLength(0);
    const cutRoofs = thatchRoofs(parts).filter(part => part.roofPlanCuts?.length);
    expect(cutRoofs, `${detailed}/L${level}: one roof pierces the lantern`).toHaveLength(1);
    const cutRoof = cutRoofs[0]!;
    expect(cutRoof.occupationRoof).toBe("hip");
    const cut = cutRoof.roofPlanCuts![0]!;
    const cutCentre = roofWorldPoint(cutRoof, cut.x, 0, cut.z);
    expect(cutCentre.x).toBeCloseTo(tower.x, 5);
    expect(cutCentre.z).toBeCloseTo(tower.z, 5);
    const cutRadius = cut.radiusX * cutRoof.size[0];
    expect(cutRadius).toBeGreaterThanOrEqual(tower.radius);
    expect(cutRadius).toBeLessThanOrEqual(tower.outerRadius + .01);
    const lowRopes = parts.filter(part => part.surface === "rope" && part.roofSupport && part.position[1] < 2.2);
    expect(lowRopes.length, `${detailed}/L${level}: the hall still carries its ridge rope`).toBeGreaterThan(0);
    for (const rope of lowRopes) {
      const { max, min } = getRomanPartBounds(rope);
      const dx = Math.max(min[0] - tower.x, 0, tower.x - max[0]);
      const dz = Math.max(min[2] - tower.z, 0, tower.z - max[2]);
      expect(Math.hypot(dx, dz), `${detailed}/L${level}: ridge rope enters the lantern drum`)
        .toBeGreaterThanOrEqual(tower.radius);
    }
    for (const roof of thatchRoofs(parts)) {
      const geometry = createMayaThatchRoof(roof, detailed);
      const metadata = geometry.userData.thatch as { coreVertices: number; strands: number };
      const positions = geometry.getAttribute("position");
      for (let vertex = 0; vertex < positions.count; vertex++) {
        expect(Math.abs(positions.getX(vertex)), `${detailed}/L${level}: roof/eave width`).toBeLessThanOrEqual(.50001);
        expect(Math.abs(positions.getZ(vertex)), `${detailed}/L${level}: roof/eave depth`).toBeLessThanOrEqual(.50001);
      }
      if (roof === cutRoof) {
        let looseVertices = 0;
        for (let vertex = metadata.coreVertices; vertex < positions.count; vertex++) {
          const world = roofWorldPoint(roof, positions.getX(vertex), positions.getY(vertex), positions.getZ(vertex));
          const distance = Math.hypot(world.x - tower.x, world.z - tower.z);
          expect(distance, `${detailed}/L${level}: loose thatch through the lantern`)
            .toBeGreaterThanOrEqual(cutRadius - 1e-5);
          looseVertices++;
        }
        expect(looseVertices, `${detailed}/L${level}: loose straw is still generated`).toBeGreaterThan(0);
      }
      geometry.dispose();
    }
  }
});
