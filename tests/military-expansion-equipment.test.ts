import type { BufferGeometry } from "three";
import { expect, it } from "vitest";

import { buildExpansionMelee } from "../src/renderers/three/military-expansion-melee";
import { buildExpansionShield } from "../src/renderers/three/military-expansion-shields";

const NATIONS = ["chinese", "persian", "indigenous", "maya"] as const;
const inspect = (geometry: BufferGeometry, budget: number) => {
  const position = geometry.getAttribute("position");
  const triangles = (geometry.index?.count ?? position.count) / 3;
  expect(triangles).toBeLessThanOrEqual(budget);
  for (const semantic of ["position", "normal", "uv", "color", "equipmentSurface"])
    expect(Array.from(geometry.getAttribute(semantic).array).every(Number.isFinite), semantic).toBe(true);
  expect(geometry.groups).toHaveLength(0);
  geometry.computeBoundingBox();
  return geometry.boundingBox!;
};

it.each([true, false])("keeps new held weapons on the shared grip/axis contract and atlas (%s)", detailed => {
  const signatures = new Set<string>();
  for (const nation of NATIONS) for (const kind of ["infantry", "cavalry", "twoHanded"] as const) {
    const geometry = buildExpansionMelee(nation, kind, detailed);
    const { max, min } = inspect(geometry, detailed ? 2200 : 900);
    expect(min.y).toBeLessThan(-.06);
    expect(max.y).toBeGreaterThan(.31);
    expect(max.y).toBeLessThan(.78);
    expect(Math.max(Math.abs(min.x), Math.abs(max.x))).toBeLessThan(.18);
    expect(Math.max(Math.abs(min.z), Math.abs(max.z))).toBeLessThan(.12);
    if (kind === "twoHanded" && nation !== "indigenous") expect(min.y).toBeLessThan(-.2);
    if (kind === "infantry") signatures.add(Array.from(geometry.getAttribute("position").array).join(","));
    geometry.dispose();
  }
  expect(signatures.size).toBe(4);
});

it.each([true, false])("backs every national shield with a solid board and a palm stand-off (%s)", detailed => {
  for (const nation of NATIONS) {
    const geometry = buildExpansionShield(nation, detailed);
    const { max, min } = inspect(geometry, detailed ? 2800 : 1100);
    expect(min.z).toBeGreaterThanOrEqual(-.00001);
    expect(min.z).toBeLessThan(.03);
    expect(max.z).toBeLessThan(.18);
    expect(max.y - min.y).toBeGreaterThan(.4);
    expect(max.x - min.x).toBeGreaterThan(.28);
    geometry.dispose();
  }
});
