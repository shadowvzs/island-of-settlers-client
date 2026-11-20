import {
  BufferAttribute,
  Color,
  DoubleSide,
  GLSL3,
  InstancedBufferGeometry,
  type IUniform,
  Mesh,
  RawShaderMaterial
} from "three";

import type { CameraState } from "../../render-common/camera-state";
import { type FishModel, getFishModels } from "../../render-common/fish-schools/fish-models";
import { addFrameThreats, createFishSchoolFocus, type FishEye } from "../../render-common/fish-schools/fish-school-focus";
import { createFishSchools } from "../../render-common/fish-schools/fish-school-sim";
import { FISH_SPECIES, type FishSpecies } from "../../render-common/fish-schools/fish-species";
import type { FrameState } from "../../render-common/renderer-contract";
import type { WorldData } from "../../shared/world/world-data";
import { FISH_FRAGMENT_GLSL, FISH_VERTEX_GLSL } from "./three-fish-schools-glsl";
import { FISH_MARKING_IDS } from "./three-fish-paint-glsl";
import { commitInstanceAttributes, createDynamicInstanceAttribute } from "./three-flyers";
import { createSeabedShadowLayer } from "./three-seabed-shadows";

type FishFrame = Pick<FrameState, "camera" | "ships" | "shuttleBoats" | "time" | "workers">;

/** Readability over nature in the iso view (fish seen from far above, half-resolution capture). */
const ISO_FISH_SCALE = 1.35;

const writeVec4 = (array: Float32Array, offset: number, a: number, b: number, c: number, d: number) => {
  array[offset] = a;
  array[offset + 1] = b;
  array[offset + 2] = c;
  array[offset + 3] = d;
};

const hideMesh = (mesh: Mesh) => {
  mesh.frustumCulled = false;
  mesh.visible = false;
  return mesh;
};

/** The species' paint and shape uniforms (colours, marking, length, thickness, sheen). */
const createSpeciesUniforms = (species: FishSpecies) => ({
  uAccent: { value: new Color(...species.accent) },
  uBack: { value: new Color(...species.back) },
  uBelly: { value: new Color(...species.belly) },
  uFinColor: { value: new Color(...species.fin) },
  uLength: { value: species.length },
  uMarking: { value: FISH_MARKING_IDS[species.marking] },
  uSheen: { value: species.sheen },
  uSide: { value: new Color(...species.side) },
  uThickness: { value: species.thickness }
});

/** One instanced draw per species: the static mesh, bent by the shader's tail wave. */
const createSpeciesLayer = (model: FishModel, species: FishSpecies, shared: Record<string, IUniform>,
  capacity: number) => {
  const { mesh: shape } = model;
  const geometry = new InstancedBufferGeometry();
  geometry.setIndex(new BufferAttribute(shape.indices, 1));
  geometry.setAttribute("position", new BufferAttribute(shape.positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(shape.normals, 3));
  geometry.setAttribute("fin", new BufferAttribute(model.fin, 1));
  const attributes = [0, 1, 2].map(() => createDynamicInstanceAttribute(capacity));
  geometry.setAttribute("iPosition", attributes[0]!);
  geometry.setAttribute("iMotion", attributes[1]!);
  geometry.setAttribute("iLook", attributes[2]!);
  geometry.instanceCount = 0;
  const material = new RawShaderMaterial({
    fragmentShader: FISH_FRAGMENT_GLSL,
    glslVersion: GLSL3,
    side: DoubleSide,
    uniforms: { ...shared, ...createSpeciesUniforms(species) },
    vertexShader: FISH_VERTEX_GLSL
  });
  const [positions, motions, looks] = attributes.map((attribute) => attribute.array as Float32Array);
  return {
    attributes, count: 0, geometry, looks: looks!, mesh: hideMesh(new Mesh(geometry, material)),
    motions: motions!, positions: positions!
  };
};

type SpeciesLayer = ReturnType<typeof createSpeciesLayer>;

/**
 * FISH-SCHOOLS: decorative schools and single reef fish in the clear shallows, drawn only into
 * the seabed refraction capture (so the water surface refracts, absorbs and hides them exactly
 * like the bed: no sorting with the surface, nothing pokes through it, nothing in the main pass,
 * SSR or AO). Five species draws plus one shadow draw, all instanced; the CPU boids live in
 * render-common/fish-schools. Built only where the preset has refraction and a fish budget.
 */
export const createThreeFishSchools = (world: WorldData, shared: Record<string, IUniform>, capacity: number,
  winter: boolean) => {
  const schools = createFishSchools(world, capacity, winter);
  const focus = createFishSchoolFocus();
  const models = getFishModels();
  const layers = models.map((model, species) =>
    createSpeciesLayer(model, FISH_SPECIES[species]!, shared, capacity));
  const shadows = createSeabedShadowLayer(shared, capacity);
  const { fish, water } = schools;
  let enabled = true;
  /** Fish draw larger in the iso view, seen from far above, than up close in the possessed view. */
  let viewScale = 1;
  // Review tools (tools/bench/fish-schools-review.ts) read the homes and the live fish.
  if (import.meta.env.DEV) (window as unknown as { __fishSchools?: unknown }).__fishSchools = schools;

  const writeFish = (layer: SpeciesLayer, index: number) => {
    const offset = layer.count * 4;
    const x = fish.x[index]!, y = fish.y[index]!, z = fish.z[index]!;
    const species = FISH_SPECIES[fish.species[index]!]!;
    const fog = water.fog(x, z);
    const size = fish.scale[index]! * fish.appear[index]! * viewScale;
    const heading = fish.heading[index]!;
    writeVec4(layer.positions, offset, x, y, z, size);
    writeVec4(layer.motions, offset, heading, fish.pitch[index]!, fish.phase[index]!, fish.wagAmplitude[index]!);
    const surface = water.surface(x, z);
    writeVec4(layer.looks, offset, fish.shade[index]!, fog, Math.max(0, surface - y), Math.max(0, surface - water.ground(x, z)));
    layer.count += 1;
    const bed = water.ground(x, z);
    shadows.add(x, bed, z, species.length * size, heading, Math.max(0, y - bed), fog, fish.appear[index]!);
  };

  const commit = (mesh: Mesh, geometry: InstancedBufferGeometry, attributes: Parameters<typeof commitInstanceAttributes>[0],
    count: number) => {
    geometry.instanceCount = count;
    mesh.visible = count > 0;
    if (count > 0) commitInstanceAttributes(attributes, count);
  };

  const writeInstances = () => {
    for (const layer of layers) layer.count = 0;
    shadows.clear();
    for (let index = 0; index < fish.capacity; index += 1) {
      if (fish.active[index] === 0 || fish.appear[index]! <= 0) continue;
      writeFish(layers[fish.species[index]!]!, index);
    }
    for (const layer of layers) commit(layer.mesh, layer.geometry, layer.attributes, layer.count);
    shadows.commit();
  };

  /** Advances the fish to the frame (the possessed eye, if any, is the focus and a threat). */
  const update = (frame: FishFrame, eye: FishEye | null) => {
    if (!enabled) return;
    viewScale = eye ? 1 : ISO_FISH_SCALE;
    addFrameThreats(schools, frame, eye);
    schools.update(frame.time, focus.update(frame.camera as CameraState, eye));
    writeInstances();
  };

  const setEnabled = (value: boolean) => {
    if (enabled === value) return;
    enabled = value;
    if (value) return;
    schools.clear();
    writeInstances();
  };

  return {
    /** Live state for review tools and tests. */
    debug: schools,
    getDrawnCount: shadows.count,
    meshes: [...layers.map((layer) => layer.mesh), shadows.mesh],
    setEnabled,
    update
  };
};

export type ThreeFishSchools = ReturnType<typeof createThreeFishSchools>;
