import {
  BufferAttribute, DoubleSide, GLSL3, InstancedBufferGeometry, type IUniform, Mesh, RawShaderMaterial
} from "three";

import { FISH_SHADOW_FRAGMENT_GLSL, FISH_SHADOW_VERTEX_GLSL } from "./three-fish-schools-glsl";
import { commitInstanceAttributes, createDynamicInstanceAttribute } from "./three-flyers";

/**
 * One instanced draw of soft seabed shadows (an elliptic quad per swimmer or floating hull), blended
 * over the bed in the refraction capture. The shader spreads, fades and shifts each shadow along the
 * refracted sun ray with the height above the bed, so deep water gets a wide, faint, offset shadow.
 */
export const createSeabedShadowLayer = (shared: Record<string, IUniform>, capacity: number) => {
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1]), 3));
  geometry.setIndex([0, 2, 1, 0, 3, 2]);
  const attributes = [0, 1].map(() => createDynamicInstanceAttribute(capacity));
  geometry.setAttribute("iShadow", attributes[0]!);
  geometry.setAttribute("iShadowShape", attributes[1]!);
  geometry.instanceCount = 0;
  const material = new RawShaderMaterial({
    depthWrite: false,
    fragmentShader: FISH_SHADOW_FRAGMENT_GLSL,
    glslVersion: GLSL3,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
    side: DoubleSide,
    transparent: true,
    uniforms: shared,
    vertexShader: FISH_SHADOW_VERTEX_GLSL
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.visible = false;
  const [places, shapes] = attributes.map(attribute => attribute.array as Float32Array) as [Float32Array, Float32Array];
  let count = 0;
  const clear = () => { count = 0; };
  /**
   * Adds one shadow: `x, bed, z` the caster's ground point, `size` its length scale, `heading` the turn of
   * its long axis (shader +x), `height` above the bed, `fog` its fog sample and `strength` its opacity.
   */
  const add = (x: number, bed: number, z: number, size: number, heading: number, height: number, fog: number,
    strength: number) => {
    if (count >= capacity) return;
    const offset = count * 4;
    places[offset] = x; places[offset + 1] = bed; places[offset + 2] = z; places[offset + 3] = size;
    shapes[offset] = heading; shapes[offset + 1] = height; shapes[offset + 2] = fog; shapes[offset + 3] = strength;
    count += 1;
  };
  const commit = () => {
    geometry.instanceCount = count;
    mesh.visible = count > 0;
    if (count > 0) commitInstanceAttributes(attributes, count);
  };
  const dispose = () => { geometry.dispose(); material.dispose(); };
  return { add, clear, commit, count: () => count, dispose, mesh };
};

export type SeabedShadowLayer = ReturnType<typeof createSeabedShadowLayer>;
