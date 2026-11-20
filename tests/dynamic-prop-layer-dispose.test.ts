import { MeshBasicMaterial } from "three";
import { expect, it } from "vitest";

import type { PropMesh } from "../src/render-common/props/mesh-builder";
import { allocatePropInstances } from "../src/render-common/props/prop-instances";
import { createDynamicPropLayer } from "../src/renderers/three/three-dynamic-props";
import { createThreePlacedProps } from "../src/renderers/three/three-placed-props";

const PROP_MESH: PropMesh = {
  colors: new Float32Array(), height: 1, indices: new Uint16Array([0, 1, 2]),
  minimalIndices: new Uint16Array([0, 1, 2]), normals: new Float32Array(), positions: new Float32Array(),
  radius: 1, uvs: new Float32Array(), wind: new Float32Array()
};

it("disposes both instanced meshes (instance matrix) and both detail indices of a dynamic layer", () => {
  const material = new MeshBasicMaterial();
  const layer = createDynamicPropLayer(PROP_MESH, 4, material, material);
  const fullIndex = layer.mesh.geometry.getIndex();
  layer.setDetail(false);
  const disposed: string[] = [];
  layer.mesh.addEventListener("dispose", () => disposed.push("mesh"));
  layer.caster!.addEventListener("dispose", () => disposed.push("caster"));
  layer.mesh.geometry.addEventListener("dispose", ({ target }) => {
    disposed.push("geometry");
    expect(Object.values(target.attributes)).toContain(fullIndex);
  });
  layer.dispose();
  expect(disposed.sort()).toEqual(["caster", "geometry", "mesh"]);
  material.dispose();
});

it("releases the previous placed-prop layers when a forester's planting rebuilds the set", () => {
  // Every mesh id resolves (a placed tree also reserves its mature mesh).
  const placed = createThreePlacedProps(new Array(4096).fill(PROP_MESH), {});
  const instances = allocatePropInstances(1);
  instances.scale.fill(1); instances.stretch.fill(1);
  placed.setInstances(instances);
  const previous = [...placed.group.children];
  expect(previous.length).toBeGreaterThan(0);
  let released = 0;
  for (const mesh of previous) mesh.addEventListener("dispose", () => { released++; });
  placed.setInstances(instances);
  expect(released).toBe(previous.length);
  expect(placed.group.children).toHaveLength(previous.length);
  expect(placed.group.children.some(mesh => previous.includes(mesh))).toBe(false);
});
