import { readFileSync } from "node:fs";
import { Box3, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import {
  BUILDING_CATALOG,
  getBuildingDefinition
} from "../src/render-common/buildings/building-catalog";
import type { BuildingPart } from "../src/render-common/buildings/building-recipe";
import { getRomanPartBounds } from "../src/render-common/buildings/building-recipe-fit";
import { catapultShellOuterRadius } from "../src/render-common/buildings/catapult-national-shell-profile";
import { MONUMENT_TYPE_ID } from "../src/render-common/buildings/monument-definition";
import { createNationBuildingRecipe } from "../src/render-common/buildings/nation-building-recipe";
import { NUBIAN_DECOR_VARIANTS } from "../src/render-common/buildings/nubian-decor-props";
import { buildingModelRecipe } from "../src/render-common/content/building-model-recipes";
import { createNubianDecorGeometry } from "../src/renderers/three/buildings/nubian-decor-geometry";
import { COMMANDER_LODGE_TYPE_ID } from "../src/shared/settlement/building-type-ids";

const isDecorShape = (part: BuildingPart) => part.shape.startsWith("nubian-") && part.stage === 4;
const decorOf = (id: number, detailed: boolean) =>
  createNationBuildingRecipe(getBuildingDefinition(id), "nubian", detailed).parts.filter(
    isDecorShape
  );
const shapesOf = (id: number, detailed: boolean) =>
  new Set(decorOf(id, detailed).map((part) => part.shape));

const overlap = (
  a: ReturnType<typeof getRomanPartBounds>,
  b: ReturnType<typeof getRomanPartBounds>
) =>
  [0, 1, 2].every(
    (axis) => a.min[axis]! < b.max[axis]! - 0.001 && b.min[axis]! < a.max[axis]! - 0.001
  );

describe("Nubian building decor", () => {
  it("fits each occupation: shields for soldiers, skulls for hunters, hats and jars for farmers", () => {
    expect(shapesOf(1, true)).toContain("nubian-shield");
    expect(shapesOf(22, true)).toContain("nubian-skull");
    expect(decorOf(22, true).find((part) => part.shape === "nubian-skull")?.decorVariant).toBe(1);
    expect(shapesOf(37, true)).toEqual(new Set(["nubian-hat", "nubian-textile", "nubian-vase"]));
    expect(shapesOf(0, true)).toContain("nubian-textile");
    expect(shapesOf(0, true)).toContain("nubian-vase");
  });

  it("decorates every walled building on both LODs, leaving the mill to its own design", () => {
    for (const definition of BUILDING_CATALOG)
      for (const detailed of [true, false]) {
        const decor = decorOf(definition.id, detailed);
        if (definition.id === COMMANDER_LODGE_TYPE_ID) {
          const parts = createNationBuildingRecipe(definition, "nubian", detailed).parts;
          expect(parts.filter((part) => part.shape === "nubian-textile" && part.stage === 3).length)
            .toBeGreaterThanOrEqual(2);
          continue;
        }
        if ([4, 31, 35, MONUMENT_TYPE_ID].includes(definition.id)) continue;
        expect(decor.length, `${definition.id}/${detailed}`).toBeGreaterThan(0);
      }
    expect(decorOf(31, true)).toEqual([]);
  });

  it("uses the authored Nubian monument GLBs instead of recipe wall decor", () => {
    expect(buildingModelRecipe(MONUMENT_TYPE_ID, "nubian", 1)).toEqual({
      kind: "authored", nation: "nubian"
    });
    for (const quality of ["high", "minimal"]) {
      const glb = readFileSync(new URL(`../assets/monuments/nubian-${quality}.glb`, import.meta.url));
      expect(glb.readUInt32LE(0)).toBe(0x46546c67);
      expect(glb.readUInt32LE(8)).toBe(glb.length);
    }
    for (const detailed of [true, false]) expect(decorOf(MONUMENT_TYPE_ID, detailed)).toEqual([]);
  });

  it("keeps Minimal cheaper: the near-budget Headquarters carries fewer props", () => {
    expect(decorOf(0, false).length).toBeLessThan(decorOf(0, true).length);
  });

  it("hangs or stands every prop clear of the building's own parts", () => {
    for (const definition of BUILDING_CATALOG)
      for (const detailed of [true, false]) {
        const parts = createNationBuildingRecipe(definition, "nubian", detailed).parts;
        const structure = parts.filter((part) => part.stage < 4 || part.stock);
        for (const prop of parts.filter(isDecorShape)) {
          const bounds = getRomanPartBounds(prop);
          expect(
            structure.some((other) => {
              if (!overlap(bounds, getRomanPartBounds(other))) return false;
              if (other.shape !== "catapult-national-shell" || prop.shape !== "nubian-shield") return true;
              // The rear face is flat over the shield width and tapers inward with height.
              const radius = catapultShellOuterRadius("nubian", Math.PI, bounds.min[1]);
              const edgeAngle = Math.atan2(bounds.max[0], -radius);
              const edgeRadius = catapultShellOuterRadius("nubian", edgeAngle, bounds.min[1]);
              expect(edgeRadius * Math.cos(edgeAngle)).toBeCloseTo(-radius, 6);
              expect(bounds.max[2]).toBeLessThan(-radius);
              return false;
            }),
            `${definition.id}/${prop.shape}`
          ).toBe(false);
          expect(prop.stage).toBe(4);
          expect(prop.decorVariant).toBeGreaterThanOrEqual(0);
        }
      }
  });

  it.each([true, false])("supports the tower shield on its tapered wall (detailed=%s)", (detailed) => {
    const parts = createNationBuildingRecipe(getBuildingDefinition(16), "nubian", detailed).parts;
    const shield = parts.find((part) => part.shape === "nubian-shield")!;
    const peg = parts.find((part) => part.architecture && part.stage === 4 && part.surface === "wood"
      && Math.abs(part.position[0] - shield.position[0]) < 0.001
      && Math.abs(part.position[1] - shield.position[1]) < 0.001)!;
    expect(peg).toBeDefined();
    const wall = -catapultShellOuterRadius("nubian", Math.PI, shield.position[1]);
    const pegBounds = getRomanPartBounds(peg);
    const shieldBounds = getRomanPartBounds(shield);
    expect(pegBounds.max[2]).toBeGreaterThan(wall);
    expect(pegBounds.min[2]).toBeLessThan(shieldBounds.max[2]);
  });

  it("is deterministic and Nubian only", () => {
    expect(createNationBuildingRecipe(getBuildingDefinition(22), "nubian", true)).toEqual(
      createNationBuildingRecipe(getBuildingDefinition(22), "nubian", true)
    );
    for (const nation of ["roman", "viking", "japanese"] as const)
      for (const definition of BUILDING_CATALOG)
        expect(createNationBuildingRecipe(definition, nation, true).parts.some(isDecorShape)).toBe(
          false
        );
  });
});

describe("Nubian decor geometry", () => {
  const SHAPES = [
    ["nubian-textile", NUBIAN_DECOR_VARIANTS.textile],
    ["nubian-vase", NUBIAN_DECOR_VARIANTS.vase],
    ["nubian-shield", NUBIAN_DECOR_VARIANTS.shield],
    ["nubian-skull", NUBIAN_DECOR_VARIANTS.skull],
    ["nubian-hat", NUBIAN_DECOR_VARIANTS.hat]
  ] as const;
  const triangles = (shape: BuildingPart["shape"], variant: number, detailed: boolean) => {
    const geometry = createNubianDecorGeometry(
      {
        decorVariant: variant,
        position: [0, 0, 0],
        shape,
        size: [1, 1, 1],
        stage: 4,
        surface: "nubian-decor"
      },
      detailed
    )!;
    const box = new Box3().setFromBufferAttribute(geometry.getAttribute("position") as never);
    const uv = geometry.getAttribute("uv");
    for (let index = 0; index < uv.count; index++) {
      expect(uv.getX(index)).toBeGreaterThanOrEqual(0);
      expect(uv.getX(index)).toBeLessThanOrEqual(1);
      expect(uv.getY(index)).toBeGreaterThanOrEqual(0);
      expect(uv.getY(index)).toBeLessThanOrEqual(1);
    }
    // Shaped meshes stay inside the authored part box, which the support and envelope checks use.
    expect(box.min.toArray().every((value) => value >= -0.5001)).toBe(true);
    expect(box.max.toArray().every((value) => value <= 0.5001)).toBe(true);
    expect(box.getSize(new Vector3()).toArray().every(Number.isFinite)).toBe(true);
    return (geometry.index?.count ?? geometry.getAttribute("position").count) / 3;
  };

  it.each(SHAPES)(
    "%s fits its unit box with in-atlas UVs and a cheaper Minimal LOD",
    (shape, variants) => {
      for (let variant = 0; variant < variants; variant++) {
        const high = triangles(shape, variant, true),
          minimal = triangles(shape, variant, false);
        expect(minimal).toBeLessThan(high);
        expect(high).toBeLessThanOrEqual(220);
        expect(minimal).toBeLessThanOrEqual(80);
      }
    }
  );

  it("leaves every other shape to the shared building geometry", () => {
    expect(
      createNubianDecorGeometry(
        { position: [0, 0, 0], shape: "box", size: [1, 1, 1], stage: 1, surface: "plaster" },
        true
      )
    ).toBeNull();
  });
});
