import { DynamicDrawUsage, Group, InstancedBufferAttribute, InstancedMesh, type IUniform, type Matrix4 } from "three";

import type { PropMesh } from "../../../render-common/props/mesh-builder";
import type { Vec3 } from "../../../render-common/props/mesh-builder";
import { createPropDepthMaterial, createPropMaterial } from "../three-prop-materials";
import { createPropGeometry } from "../three-props";

const WHITE: Vec3 = [1, 1, 1];
const INITIAL_CAPACITY = 16;

interface Layer {
  caster: InstancedMesh | null;
  chop: InstancedBufferAttribute;
  count: number;
  data: InstancedBufferAttribute;
  mesh: InstancedMesh;
  tint: InstancedBufferAttribute;
}

/**
 * Props placed by game state rather than by the world (crops, hives, planted palms): one
 * instanced mesh per prop mesh, drawn with the shared vegetation material, so they get the same
 * wind, leaf light, fog of war and sun shadows as the island's plants. Each frame the caller
 * pushes the visible instances; the GPU does all animation (wind, flutter).
 */
export const createPlacedPropLayers = (
  uniforms: Record<string, IUniform>, castShadows: boolean, createMesh: (key: string) => PropMesh
) => {
  const group = new Group(); group.name = "placed_crop_props";
  const casters = new Group(); casters.name = "placed_crop_casters";
  // The felling code path: its rattle (instanceChop.x) shakes a palm when its grower shakes it.
  const main = createPropMaterial(uniforms, false, true);
  const depth = castShadows ? createPropDepthMaterial(uniforms, true) : null;
  const meshes = new Map<string, PropMesh>();
  const layers = new Map<string, Layer>();

  const createLayer = (key: string, capacity: number): Layer => {
    const propMesh = meshes.get(key) ?? createMesh(key);
    meshes.set(key, propMesh);
    const geometry = createPropGeometry(propMesh);
    const data = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    const tint = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    const chop = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    geometry.setAttribute("instanceData", data); geometry.setAttribute("instanceTint", tint);
    geometry.setAttribute("instanceChop", chop);
    const mesh = new InstancedMesh(geometry, main, capacity);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage); mesh.frustumCulled = false; mesh.count = 0;
    const caster = depth ? new InstancedMesh(geometry, depth, capacity) : null;
    if (caster) { caster.instanceMatrix = mesh.instanceMatrix; caster.frustumCulled = false; caster.count = 0; }
    group.add(mesh); if (caster) casters.add(caster);
    return { caster, chop, count: 0, data, mesh, tint };
  };

  const removeLayer = (layer: Layer) => {
    layer.mesh.removeFromParent(); layer.caster?.removeFromParent(); layer.mesh.geometry.dispose();
  };

  /** Layer with room for one more instance (doubling its capacity when full). */
  const layerFor = (key: string) => {
    const known = layers.get(key);
    if (known && known.count < known.mesh.instanceMatrix.count) return known;
    const grown = createLayer(key, known ? known.mesh.instanceMatrix.count * 2 : INITIAL_CAPACITY);
    if (known) {
      grown.mesh.instanceMatrix.array.set(known.mesh.instanceMatrix.array);
      grown.data.array.set(known.data.array); grown.tint.array.set(known.tint.array);
      grown.chop.array.set(known.chop.array);
      grown.count = known.count; removeLayer(known);
    }
    layers.set(key, grown);
    return grown;
  };

  const begin = () => { for (const layer of layers.values()) layer.count = 0; };

  /** One instance of a prop mesh: transform, wind phase, tint multiplier and shake (0..1). */
  const push = (key: string, matrix: Matrix4, phase: number, tint: Vec3 = WHITE, shake = 0) => {
    const layer = layerFor(key), slot = layer.count;
    matrix.toArray(layer.mesh.instanceMatrix.array, slot * 16);
    layer.data.array.set([phase, 1, 1, 0], slot * 4);
    layer.tint.array.set(tint, slot * 3);
    layer.chop.array.set([shake, 0, 0, 0], slot * 4);
    layer.count += 1;
  };

  const commit = () => {
    for (const layer of layers.values()) {
      for (const item of [layer.mesh, layer.caster]) {
        if (!item) continue;
        item.count = layer.count; item.visible = layer.count > 0;
      }
      layer.mesh.instanceMatrix.needsUpdate = true; layer.data.needsUpdate = true; layer.tint.needsUpdate = true;
      layer.chop.needsUpdate = true;
    }
  };

  const dispose = () => {
    for (const layer of layers.values()) removeLayer(layer);
    layers.clear(); main.dispose(); depth?.dispose();
  };
  return { begin, casters, commit, dispose, group, push };
};
