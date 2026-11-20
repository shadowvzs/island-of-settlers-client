import { describe, expect, it } from "vitest";

import {
  type LayoutEntry,
  layoutSpriteAtlas} from "../src/render-common/baker/sprite-atlas-layout";
import type { PropMesh } from "../src/render-common/props/mesh-builder";
import { PROP_MESH_SEED } from "../src/render-common/props/prop-mesh-seed";
import { createPropMeshes, getMeshKind } from "../src/render-common/props/prop-meshes";
import { isImpostorKind } from "../src/renderers/three/three-impostors";

const overlaps = (a: LayoutEntry, b: LayoutEntry) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** The far zoom impostor bake's meshes (sparse: only the impostor kinds). */
const createImpostorMeshes = () => {
  const kept: PropMesh[] = [];
  createPropMeshes(PROP_MESH_SEED).forEach((mesh, meshId) => {
    if (isImpostorKind(getMeshKind(meshId))) kept[meshId] = mesh;
  });
  return kept;
};

describe("sprite atlas layout", () => {
  it("packs every impostor sprite into one atlas without overlaps", () => {
    const meshes = createImpostorMeshes();
    const layout = layoutSpriteAtlas(meshes);
    expect(layout.entries.map((entry) => entry.meshId)).toEqual(Object.keys(meshes).map(Number));
    expect(layout.height % 4).toBe(0);
    expect(layout.height).toBeLessThanOrEqual(16384);
    layout.entries.forEach((entry, index) => {
      expect(entry.x + entry.width).toBeLessThanOrEqual(layout.width);
      expect(entry.y + entry.height).toBeLessThanOrEqual(layout.height);
      const hit = layout.entries.slice(index + 1).some((other) => overlaps(entry, other));
      expect(hit).toBe(false);
    });
  });
});
