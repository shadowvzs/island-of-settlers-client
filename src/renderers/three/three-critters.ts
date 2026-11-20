import {
  BufferAttribute,
  DataTexture,
  DoubleSide,
  FloatType,
  GLSL3,
  Group,
  InstancedBufferGeometry,
  type IUniform,
  Mesh,
  NearestFilter,
  RawShaderMaterial,
  RGBAFormat,
  type Vector4
} from "three";

import { CRITTER_CAPACITY } from "../../render-common/critters/critter-manager";
import { getCritterModel, loadCritterSpecies } from "../../render-common/critters/critter-models";
import { CRITTER_SPECIES, isHibernating } from "../../render-common/critters/critter-species";
import {
  createFramePair,
  type CritterModel,
  resolveClipFrames} from "../../render-common/critters/model/critter-model";
import type { CritterFrame } from "../../render-common/critters/sim/critter-pool";
import type { PresentationScheduler } from "../../render-common/presentation-scheduler";
import { SURFACE_COLOR_OUTPUT_GLSL } from "../../render-common/shaders/color-output-glsl";
import { COMMON_UNIFORMS_GLSL, FOG_OF_WAR_GLSL, HEADING_TURN_GLSL, LIGHTING_GLSL, NOISE_GLSL } from "../../render-common/shaders/common-glsl";
import { PROP_FOG_GLSL } from "../../render-common/shaders/prop-glsl";
import { SEASON_ICE_RAMP } from "../../render-common/shaders/season-ground-glsl";
import { smoothstep } from "../../shared/world/noise";
import { commitInstanceAttributes, createDynamicInstanceAttribute } from "./three-flyers";
import { getDepthOnlyDefines, SUN_SHADOW_GLSL } from "./three-shadows";

/**
 * Pose morphing on the GPU: every frame of a species is one pair of rows (positions, normals)
 * in a float texture; the vertex shader fetches its two frames by gl_VertexID and blends them,
 * then turns the critter to its heading and places it. iPosition: xyz, scale; iPose: heading,
 * frame a, frame b, blend; iLook: shade, fog visibility.
 */
const VERTEX_GLSL = `
precision highp float;
precision highp sampler2D;
in vec3 position;
in vec3 color;
in vec4 iPosition;
in vec4 iPose;
in vec4 iLook;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform sampler2D uFrames;
out vec3 vWorld;
out vec3 vNormal;
out vec3 vColor;
out float vFog;

vec3 fetchFrame(float frame, int row) {
  return texelFetch(uFrames, ivec2(gl_VertexID, int(frame) * 2 + row), 0).xyz;
}

${HEADING_TURN_GLSL}
void main() {
  vec3 local = mix(fetchFrame(iPose.y, 0), fetchFrame(iPose.z, 0), iPose.w);
  vec3 normal = mix(fetchFrame(iPose.y, 1), fetchFrame(iPose.z, 1), iPose.w);
  vWorld = iPosition.xyz + turn(local, iPose.x) * iPosition.w;
  vNormal = turn(normal, iPose.x);
  vColor = color * iLook.x;
  vFog = iLook.y;
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}
`;

const FRAGMENT_GLSL = `
precision highp float;
in vec3 vWorld;
in vec3 vNormal;
in vec3 vColor;
in float vFog;
out vec4 fragColor;
${COMMON_UNIFORMS_GLSL}
${NOISE_GLSL}
${LIGHTING_GLSL}
${FOG_OF_WAR_GLSL}
${PROP_FOG_GLSL}
${SUN_SHADOW_GLSL}
${SURFACE_COLOR_OUTPUT_GLSL}

void main() {
  if (isHiddenByFog(vFog, vWorld.xz)) discard;
#ifdef DEPTH_ONLY
  fragColor = vec4(1.0);
#else
  vec3 normal = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
  vec3 color = lightSurface(vColor, normal, sampleSunShadow(vWorld), 1.0, vWorld.xz);
  fragColor = vec4(finishSurface(applyFogOfWar(color, vFog, vWorld.xz), vWorld), 1.0);
#endif
}
`;

/** Positions and normals of every frame, two texture rows per frame. */
const createFrameTexture = (model: CritterModel) => {
  const vertices = model.frames[0]!.positions.length / 3;
  const rows = model.frames.length * 2;
  const data = new Float32Array(vertices * rows * 4);
  model.frames.forEach((frame, index) => {
    for (let vertex = 0; vertex < vertices; vertex += 1) {
      for (let axis = 0; axis < 3; axis += 1) {
        data[(index * 2 * vertices + vertex) * 4 + axis] = frame.positions[vertex * 3 + axis]!;
        data[((index * 2 + 1) * vertices + vertex) * 4 + axis] = frame.normals[vertex * 3 + axis]!;
      }
    }
  });
  const texture = new DataTexture(data, vertices, rows, RGBAFormat, FloatType);
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.needsUpdate = true;
  return texture;
};

const createMaterial = (uniforms: Record<string, IUniform>, depthOnly: boolean) =>
  new RawShaderMaterial({
    defines: getDepthOnlyDefines(depthOnly),
    fragmentShader: FRAGMENT_GLSL,
    glslVersion: GLSL3,
    side: DoubleSide,
    uniforms,
    vertexShader: VERTEX_GLSL
  });

const createSpeciesLayer = (
  model: CritterModel,
  shared: Record<string, IUniform>,
  shadow: boolean
) => {
  const first = model.frames[0]!;
  const geometry = new InstancedBufferGeometry();
  geometry.setIndex(new BufferAttribute(first.indices, 1));
  geometry.setAttribute("position", new BufferAttribute(first.positions, 3));
  geometry.setAttribute("color", new BufferAttribute(first.colors, 3));
  const attributes = [
    createDynamicInstanceAttribute(CRITTER_CAPACITY),
    createDynamicInstanceAttribute(CRITTER_CAPACITY),
    createDynamicInstanceAttribute(CRITTER_CAPACITY)
  ];
  geometry.setAttribute("iPosition", attributes[0]!);
  geometry.setAttribute("iPose", attributes[1]!);
  geometry.setAttribute("iLook", attributes[2]!);
  geometry.instanceCount = 0;
  const uniforms = { ...shared, uFrames: { value: createFrameTexture(model) } };
  const mesh = new Mesh(geometry, createMaterial(uniforms, false));
  const caster = shadow ? new Mesh(geometry, createMaterial(uniforms, true)) : null;
  for (const item of [mesh, caster]) {
    if (!item) continue;
    item.frustumCulled = false;
    item.visible = false;
  }
  const [positions, poses, looks] = attributes.map((item) => item.array as Float32Array);
  return {
    attributes,
    caster,
    count: 0,
    geometry,
    looks: looks!,
    mesh,
    poses: poses!,
    positions: positions!
  };
};

type SpeciesLayer = ReturnType<typeof createSpeciesLayer>;

const pair = createFramePair();

const writeInstance = (
  layer: SpeciesLayer,
  model: CritterModel,
  frame: CritterFrame,
  index: number
) => {
  const offset = layer.count * 4;
  const { looks, poses, positions } = layer;
  resolveClipFrames(model, frame.clip[index]!, frame.pose[index]!, pair);
  positions[offset] = frame.x[index]!;
  positions[offset + 1] = frame.y[index]!;
  positions[offset + 2] = frame.z[index]!;
  positions[offset + 3] = frame.scale[index]!;
  poses[offset] = frame.heading[index]!;
  poses[offset + 1] = pair.from;
  poses[offset + 2] = pair.to;
  poses[offset + 3] = pair.blend;
  looks[offset] = frame.shade[index]!;
  looks[offset + 1] = frame.visibility[index]!;
  layer.count += 1;
};

/** Whether the layers were drawn: species loaded later build in leftover frame time instead of at once. */
const createLayerBuilds = (presentation: PresentationScheduler | undefined, build: (species: number) => void) => {
  let drawing = false;
  const schedule = (species: readonly number[]) => {
    if (!drawing || !presentation) {
      species.forEach(build);
      return;
    }
    for (const id of species) presentation.enqueue({ step: () => { build(id); return true; } });
  };
  return { markDrawing: () => { drawing = true; }, schedule };
};

/**
 * Decorative critters in 3D: one instanced draw per species in view (plus its sun shadow
 * caster), the poses morphed on the GPU from a frame texture, real sun shadows received; the
 * cosmetic winter picks the winter coats when built and leaves hibernating species undrawn;
 * Minimal builds the lighter models. Only the species an island spawns are loaded (`prepare`,
 * awaited before the first frame); a species first met later loads on demand and builds in
 * leftover frame time (it is not drawn until then, the simulation never waits for it).
 */
/**
 * Share of the hibernating critters asleep (seasons-6): the global snow cover's ice ramp (uSeasonCover.w), so they
 * retreat as the ground freezes and return with the melt; a renderer without the season uniform (tests, showcases)
 * keeps the prepared all-or-nothing winter.
 */
const getHibernation = (shared: Record<string, IUniform>, visualWinter: boolean) => {
  const cover = shared.uSeasonCover?.value as Vector4 | undefined;
  if (!cover) return visualWinter ? 1 : 0;
  return smoothstep(SEASON_ICE_RAMP[0], SEASON_ICE_RAMP[1], cover.w);
};

export const createThreeCritters = (
  shared: Record<string, IUniform>,
  visualWinter: boolean,
  minimalDetail = false,
  presentation?: PresentationScheduler
) => {
  const root = new Group();
  const casterRoot = new Group();
  const layers: (SpeciesLayer | undefined)[] = CRITTER_SPECIES.map(() => undefined);
  const models: (CritterModel | undefined)[] = CRITTER_SPECIES.map(() => undefined);
  const requested = new Set<number>();
  let ready: Promise<void> = Promise.resolve();

  const build = (species: number) => {
    if (layers[species]) return;
    const model = getCritterModel(species, visualWinter, minimalDetail);
    if (!model) return;
    const layer = createSpeciesLayer(model, shared, CRITTER_SPECIES[species]!.shadow);
    models[species] = model;
    layers[species] = layer;
    root.add(layer.mesh);
    if (layer.caster) casterRoot.add(layer.caster);
  };
  const builds = createLayerBuilds(presentation, build);

  /** Loads the species' models (once each); before the first draw they are built at once. */
  const prepare = (species: Iterable<number>) => {
    const wanted = [...species].filter((id) => !requested.has(id));
    wanted.forEach((id) => requested.add(id));
    if (wanted.length === 0) return ready;
    const load = loadCritterSpecies(wanted).then(builds.schedule);
    ready = Promise.all([ready, load]).then(() => undefined);
    return load;
  };

  const writeInstances = (frame: CritterFrame) => {
    const hibernation = getHibernation(shared, visualWinter);
    for (let index = 0; index < frame.count; index += 1) {
      const species = frame.species[index]!;
      if (isHibernating(species, hibernation, frame.shade[index]!)) continue;
      const layer = layers[species];
      if (layer) writeInstance(layer, models[species]!, frame, index);
      else if (!requested.has(species)) void prepare([species]);
    }
  };

  const update = (frame: CritterFrame) => {
    builds.markDrawing();
    for (const layer of layers) if (layer) layer.count = 0;
    writeInstances(frame);
    for (const layer of layers) {
      if (!layer) continue;
      layer.geometry.instanceCount = layer.count;
      layer.mesh.visible = layer.count > 0;
      if (layer.caster) layer.caster.visible = layer.count > 0;
      if (layer.count > 0) commitInstanceAttributes(layer.attributes, layer.count);
    }
  };

  return {
    casters: [casterRoot],
    /** Instances drawn this frame per species (tests and statistics). */
    getDrawnCounts: () => layers.map((layer) => layer?.count ?? 0),
    meshes: [root],
    prepare,
    update,
    /** Settles once every species asked for so far is loaded (built at once before the first draw). */
    whenReady: () => ready
  };
};
