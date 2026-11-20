import { Box3, DataTexture, Mesh } from "three";
import { expect, it } from "vitest";

import {
  getRoadDecorationItem, type RoadDecorationItemId, roadDecorationItemIdsReleasedBy, roadDecorationItemsTagged
} from "../../island-of-settlers-shared/src/road-decoration-items";
import { roadDecorationMessages } from "../src/app/player-inventory/road-decoration-presentation";
import { CLIMBER_FOLIAGE_ATLAS } from "../src/render-common/plants/climber-foliage-atlas-manifest";
import { roadDecorationClearance, roadDecorationPartVolumes } from "../src/render-common/road-decoration-clearance";
import { CLIMBER_TRIANGLE_BUDGET, createClimberRoadRecipe } from "../src/render-common/road-decoration-climbers";
import { createRoadDecorationRecipe } from "../src/render-common/road-decoration-models";
import type { RoadClimberStem, RoadDecorationPart,
  RoadFoliagePart } from "../src/render-common/road-decoration-recipe";
import { createDecorationFoliageMaterial } from "../src/renderers/three/plants/decoration-foliage-material";
import { ornamentalDecorationProfile } from "../src/renderers/three/plants/ornamental-decoration-profile";
import { createRoadDecorationModel } from "../src/renderers/three/road-decoration-model";
import type { RoadClimberKind } from "../src/shared/settlement/road-decoration-catalog";
import { getRoadDecoration } from "../src/shared/settlement/road-decoration-catalog";
import { createPlainBuildingMaterials } from "./helpers/building-materials";

const kinds = ["climbing-rose-white", "climbing-rose-red", "ivy-lattice"] as const satisfies RoadClimberKind[];

const foliageParts = (parts: readonly RoadDecorationPart[]) => parts.filter((part): part is RoadFoliagePart =>
  "kind" in part && (part.kind === "foliage-card" || part.kind === "rose-head"));
const cards = (parts: readonly RoadDecorationPart[], tiles?: readonly string[]) => foliageParts(parts)
  .filter(part => part.kind === "foliage-card" && (!tiles || tiles.includes(part.tile)));
const stemsOf = (parts: readonly RoadDecorationPart[]) =>
  parts.filter((part): part is RoadClimberStem => "kind" in part && part.kind === "climber-stem");

const distanceToStem = (point: readonly number[], stem: RoadClimberStem) => {
  let best = Infinity;
  for (let index = 1; index < stem.points.length; index++) {
    const from = stem.points[index - 1]!, to = stem.points[index]!;
    const delta = to.map((value, axis) => value - from[axis]!);
    const length = delta.reduce((sum, value) => sum + value * value, 0) || 1;
    const along = delta.reduce((sum, value, axis) => sum + value * (point[axis]! - from[axis]!), 0) / length;
    const t = Math.max(0, Math.min(1, along));
    best = Math.min(best, Math.hypot(...point.map((value, axis) => value - from[axis]! - delta[axis]! * t)));
  }
  return best;
};

const foliageMaterials = (detailed: boolean) => {
  const texture = () => new DataTexture(new Uint8Array(4), 1, 1);
  return createDecorationFoliageMaterial({ antialias: true, detailed, maps: { albedo: texture(),
    normal: detailed ? texture() : null, orm: texture() }, tiles: CLIMBER_FOLIAGE_ATLAS.tiles });
};

it("registers the three approved climbing SKUs in the released decoration picker", () => {
  expect(Object.keys(roadDecorationItemsTagged("climber"))).toHaveLength(3);
  for (const kind of kinds) {
    const id = `roadDecoration:${kind}:native` as RoadDecorationItemId, item = getRoadDecorationItem(id)!;
    expect(item).toMatchObject({ category: "arches", decoration: kind, finish: "native", shopAvailable: true });
    expect(roadDecorationItemIdsReleasedBy("decoration").has(id)).toBe(true);
    expect(roadDecorationMessages(id)?.name).toBeDefined();
    expect(getRoadDecoration(kind)).toMatchObject({ climber: kind, family: "climber", placement: "across-road" });
  }
});

it.each(kinds)("%s keeps every low part outside the 1.55m clear passage at both LODs", kind => {
  const definition = getRoadDecoration(kind)!;
  expect(definition.opening).toEqual({ width: 1.55, height: 2.1 });
  for (const detailed of [true, false]) {
    const recipe = createRoadDecorationRecipe(definition, detailed);
    expect(recipe.wind).toBe(0);
    expect(recipe.parts.length).toBeGreaterThan(40);
    for (const part of recipe.parts) for (const box of roadDecorationPartVolumes(part)) {
      expect([...box.min, ...box.max].every(Number.isFinite)).toBe(true);
      if (box.min[1] < definition.opening!.height)
        expect(box.min[0] > definition.opening!.width / 2 || box.max[0] < -definition.opening!.width / 2,
          `${kind}/${detailed}/${"kind" in part ? part.kind : part.shape} ${JSON.stringify(box)}`).toBe(true);
    }
  }
});

it.each(kinds)("%s is built from textured atlas cards on real stems, never the old procedural leaves", kind => {
  const detailed = createClimberRoadRecipe(kind, true), minimal = createClimberRoadRecipe(kind, false);
  expect(detailed.length).toBeGreaterThan(minimal.length);
  for (const parts of [detailed, minimal]) expect(parts.every(part => !("kind" in part) ||
    !["wisteria-raceme", "rose-leaf", "ivy-leaf", "rose-bloom"].includes(part.kind))).toBe(true);
  const heads = foliageParts(detailed).filter(part => part.kind === "rose-head");
  if (kind === "ivy-lattice") {
    expect(heads).toHaveLength(0);
    expect(cards(detailed).length).toBeGreaterThanOrEqual(250);
    expect(cards(detailed, ["ivy-cluster-4", "ivy-cluster-7"]).length).toBeGreaterThanOrEqual(55);
    expect(cards(detailed, ["ivy-adult-cordate"]).length).toBeGreaterThan(0);
    expect(cards(minimal).length).toBeGreaterThanOrEqual(80);
    expect(cards([...detailed, ...minimal], ["rose-bud", "rose-open-head", "rose-compound-leaf-5"])).toHaveLength(0);
    return;
  }
  expect(heads.length).toBeGreaterThanOrEqual(25);
  expect(cards(detailed, ["rose-compound-leaf-5", "rose-compound-leaf-7"]).length).toBeGreaterThanOrEqual(120);
  expect(cards(detailed, ["rose-bud"]).length).toBeGreaterThanOrEqual(70);
  expect(cards(minimal).length).toBeGreaterThanOrEqual(50);
  expect(cards(minimal, ["rose-bloom-cluster", "rose-open-head"]).length).toBeGreaterThanOrEqual(12);
  expect(cards([...detailed, ...minimal], ["ivy-juvenile-3-lobed", "ivy-cluster-7"])).toHaveLength(0);
});

it.each(kinds)("%s attaches every leaf, bud and bloom to a supporting stem at both LODs", kind => {
  for (const detailed of [true, false]) {
    const parts = createClimberRoadRecipe(kind, detailed), stems = stemsOf(parts);
    expect(stems.length).toBeGreaterThan(8);
    for (const part of foliageParts(parts)) {
      const gap = Math.min(...stems.map(stem => distanceToStem(part.position, stem)));
      expect(gap, `${kind}/${detailed}/${"tile" in part ? part.tile : part.kind}`).toBeLessThan(.012);
    }
  }
});

it.each(kinds)("%s keeps the Minimal recipe as its far tier", kind => {
  const id = `roadDecoration:${kind}:native` as RoadDecorationItemId;
  const high = ornamentalDecorationProfile(id, true)!, minimal = ornamentalDecorationProfile(id, false)!;
  expect(high.cost).toBe(CLIMBER_TRIANGLE_BUDGET[kind].high);
  expect(minimal.cost).toBe(CLIMBER_TRIANGLE_BUDGET[kind].minimal);
  expect(high.farCost).toBe(minimal.cost);
});

it("white and red roses share one geometry and differ only in petal tint", () => {
  const strip = (parts: readonly RoadDecorationPart[]) => parts.map(part => ({ ...part, tint: undefined }));
  const white = createClimberRoadRecipe("climbing-rose-white", true);
  const red = createClimberRoadRecipe("climbing-rose-red", true);
  expect(strip(white)).toEqual(strip(red));
  const petals = (parts: readonly RoadDecorationPart[]) => foliageParts(parts)
    .filter(part => part.kind === "rose-head").map(part => part.tint.join(":"));
  expect(petals(white)).not.toEqual(petals(red));
});

it.each(kinds)("%s builds affordable High/Minimal runtime meshes and two separate clearance supports", kind => {
  const definition = getRoadDecoration(kind)!;
  const materials = createPlainBuildingMaterials();
  try {
    for (const detailed of [true, false]) {
      const recipe = createRoadDecorationRecipe(definition, detailed), foliage = foliageMaterials(detailed);
      const model = createRoadDecorationModel(recipe, materials, detailed, foliage);
      try {
        const leaves = model.root.children.find(child => child.name === "foliage") as Mesh;
        expect(leaves.material).toBe(foliage.material);
        expect(leaves.customDepthMaterial).toBe(foliage.depth);
        expect(model.root.children.some(child => child.name === "leaf" || child.name === "paint")).toBe(false);
        const budget = CLIMBER_TRIANGLE_BUDGET[kind][detailed ? "high" : "minimal"];
        expect(model.triangles).toBeGreaterThan(50);
        expect(model.triangles).toBeLessThanOrEqual(budget);
        expect(new Box3().setFromObject(model.root).min.y).toBeGreaterThanOrEqual(-.001);
        const volumes = roadDecorationClearance(definition).volumes;
        model.root.updateMatrixWorld(true);
        model.root.traverse(object => {
          if (!(object instanceof Mesh)) return;
          expect(object.geometry.getAttribute("wind")).toBeUndefined();
          const positions = object.geometry.getAttribute("position");
          for (let vertex = 0; vertex < positions.count; vertex++) {
            const point = [positions.getX(vertex), positions.getY(vertex), positions.getZ(vertex)];
            expect(volumes.some(box => point.every((value, axis) =>
              value >= box.min[axis]! - 2e-3 && value <= box.max[axis]! + 2e-3)),
            `${kind}/${detailed}/${object.name} vertex ${point.join(",")}`).toBe(true);
          }
        });
      } finally { model.dispose(); foliage.dispose(); }
    }
    const clearance = roadDecorationClearance(definition);
    expect(clearance.supports).toHaveLength(2);
    for (const box of clearance.supports)
      expect(box.max[0] <= -definition.opening!.width / 2 || box.min[0] >= definition.opening!.width / 2).toBe(true);
  } finally { Object.values(materials).forEach(material => material.dispose()); }
});
