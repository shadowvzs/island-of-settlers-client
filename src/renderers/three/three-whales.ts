import {
  BufferAttribute,
  BufferGeometry,
  type Camera,
  DoubleSide,
  GLSL3,
  type IUniform,
  Mesh,
  RawShaderMaterial,
  Vector2,
  Vector3,
  Vector4
} from "three";

import { whaleModelRecipe } from "../../render-common/content/whale-model-recipes";
import type { WhaleDetailLevel } from "../../render-common/quality";
import { SURFACE_COLOR_OUTPUT_GLSL } from "../../render-common/shaders/color-output-glsl";
import {
  COMMON_UNIFORMS_GLSL,
  FOG_OF_WAR_GLSL,
  LIGHTING_GLSL,
  NOISE_GLSL
} from "../../render-common/shaders/common-glsl";
import { WHALE_BEND_GLSL, WHALE_SKIN_GLSL } from "../../render-common/shaders/whale-glsl";
import { createWhaleDirector, type WhaleFrame } from "../../render-common/whales/whale-director";
import { WHALE_DETAIL } from "../../render-common/whales/whale-model";
import { WHALE_SHAPES, type WhaleSpecies } from "../../render-common/whales/whale-species";
import type { WorldData } from "../../shared/world/world-data";
import { getDepthOnlyDefines, SUN_SHADOW_GLSL } from "./three-shadows";
import { createWhaleView } from "./three-whale-view";
import { createThreeWhaleWater } from "./three-whale-water";

const VERTEX_GLSL = `
precision highp float;
in vec3 position;
in vec3 normal;
in vec3 skin;
in float spine;
uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
${WHALE_BEND_GLSL}
out vec3 vWorld;
out vec3 vNormal;
out vec3 vSkin;
out vec3 vRest;

void main() {
  vec3 point = position;
  vec3 bent = normal;
  float part = floor(skin.x);
  if (part > 0.5 && part < 2.5) turnPectoral(point, bent, part < 1.5 ? 1.0 : -1.0);
  bendWhale(spine, point, bent);
  vWorld = (modelMatrix * vec4(point, 1.0)).xyz;
  vNormal = normalize(mat3(modelMatrix) * bent);
  vSkin = skin;
  vRest = position;
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}
`;

/**
 * Lit like the critters (sun, sky, sun shadow), with a wet glint and sky reflection; the skin's
 * relief bumps the normal from screen derivatives (no tangents, no texture).
 */
const FRAGMENT_GLSL = `
precision highp float;
in vec3 vWorld;
in vec3 vNormal;
in vec3 vSkin;
in vec3 vRest;
out vec4 fragColor;
uniform vec3 cameraPosition;
uniform float uSpecies;
uniform float uWhaleLength;
${COMMON_UNIFORMS_GLSL}
${NOISE_GLSL}
${LIGHTING_GLSL}
${FOG_OF_WAR_GLSL}
${SUN_SHADOW_GLSL}
${SURFACE_COLOR_OUTPUT_GLSL}
${WHALE_SKIN_GLSL}

vec3 bumpNormal(vec3 normal, float height) {
  vec3 dx = dFdx(vWorld);
  vec3 dy = dFdy(vWorld);
  vec3 r1 = cross(dy, normal);
  vec3 r2 = cross(normal, dx);
  float det = dot(dx, r1);
  vec3 gradient = sign(det) * (dFdx(height) * r1 + dFdy(height) * r2);
  return normalize(abs(det) * normal - gradient);
}

void main() {
#ifdef DEPTH_ONLY
  fragColor = vec4(1.0);
#else
  WhaleSkin skin = whaleSkin(vSkin, vRest);
  vec3 normal = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
#ifndef WHALE_LITE
  normal = bumpNormal(normal, skin.height * uWhaleLength);
#endif
  vec3 toEye = normalize(cameraPosition - vWorld);
  float sun = sampleSunShadow(vWorld);
  vec3 color = lightSurface(skin.albedo, normal, sun, 1.0, vWorld.xz);
  float facing = max(dot(normal, toEye), 0.0);
  // Capped at grazing angles: faceted crests (fin edges, the back's midline) would glint in dashes.
  float fresnel = 0.04 + 0.96 * pow(1.0 - max(facing, 0.25), 5.0);
  float glint = pow(max(dot(normal, normalize(uSunDirection + toEye)), 0.0), mix(24.0, 110.0, skin.gloss));
  color += uSunColor * glint * skin.gloss * sun * mix(0.5, 1.0, uHighlight) * 0.3;
  color += skyReflection(reflect(-toEye, normal)) * fresnel * skin.gloss * 0.25;
  fragColor = vec4(finishSurface(color, vWorld), 1.0);
#endif
}
`;

/** Below this many pixels of body length the full preset draws the light body. */
const LITE_BODY_PIXELS = 160;
const RINGS = 16;
const SPRAY: Readonly<Record<WhaleDetailLevel, number>> = { full: 320, lite: 120 };

const createGeometry = (species: WhaleSpecies, level: WhaleDetailLevel) => {
  const mesh = whaleModelRecipe(species).build(WHALE_DETAIL[level]);
  const geometry = new BufferGeometry();
  geometry.setIndex(new BufferAttribute(mesh.indices, 1));
  geometry.setAttribute("position", new BufferAttribute(mesh.positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(mesh.normals, 3));
  geometry.setAttribute("skin", new BufferAttribute(mesh.skin, 3));
  geometry.setAttribute("spine", new BufferAttribute(mesh.spine, 1));
  return geometry;
};

const createMaterial = (uniforms: Record<string, IUniform>, level: WhaleDetailLevel, depthOnly: boolean) =>
  new RawShaderMaterial({
    defines: { ...getDepthOnlyDefines(depthOnly), ...(level === "lite" ? { WHALE_LITE: "" } : {}) },
    fragmentShader: FRAGMENT_GLSL,
    glslVersion: GLSL3,
    side: DoubleSide,
    uniforms,
    vertexShader: VERTEX_GLSL
  });

export interface WhaleDrawOptions {
  level: WhaleDetailLevel;
  /** Cast into the sun shadow map (presets with a sun pass). */
  sunShadows: boolean;
}

/**
 * The decorative whale (see whale-director.ts): one non-instanced body mesh bent in its vertex
 * shader, its sun shadow caster (High), and the water layer (spray, foam, rings, the submerged
 * shadow). Everything is hidden between events: no draw, no upload.
 */
export const createThreeWhales = (shared: Record<string, IUniform>, world: WorldData, options: WhaleDrawOptions) => {
  const director = createWhaleDirector(world, { rings: RINGS, spray: SPRAY[options.level] });
  const levels: WhaleDetailLevel[] = options.level === "full" ? ["full", "lite"] : ["lite"];
  const geometries = WHALE_SHAPES.map((_, species) =>
    levels.map((level) => createGeometry(species as WhaleSpecies, level)));
  const bend = new Vector4();
  const uniforms = {
    ...shared,
    uPectoralRoot: { value: new Vector2() },
    uSpecies: { value: 0 },
    uWhaleBend: { value: bend },
    uWhaleLength: { value: 1 }
  };
  const mesh = new Mesh(geometries[0]![0], createMaterial(uniforms, options.level, false));
  const caster = options.sunShadows ? new Mesh(mesh.geometry, createMaterial(uniforms, options.level, true)) : null;
  for (const item of [mesh, caster]) {
    if (!item) continue;
    item.frustumCulled = false;
    item.matrixAutoUpdate = false;
    item.visible = false;
  }
  const water = createThreeWhaleWater(shared, SPRAY[options.level], RINGS);
  const view = createWhaleView();
  const centre = new Vector3();

  const pickLevel = (frame: WhaleFrame, camera: Camera, viewportHeight: number) => {
    if (levels.length === 1) return 0;
    const { length } = WHALE_SHAPES[frame.pose.species]!;
    centre.set(frame.pose.x, frame.pose.y, frame.pose.z);
    return view.projectedSize(camera, centre, length) * viewportHeight < LITE_BODY_PIXELS ? 1 : 0;
  };

  const placeBody = (frame: WhaleFrame, camera: Camera, viewportHeight: number) => {
    const { pose } = frame;
    const shape = WHALE_SHAPES[pose.species]!;
    const geometry = geometries[pose.species]![pickLevel(frame, camera, viewportHeight)]!;
    const elements = mesh.matrix.elements;
    for (let column = 0; column < 3; column += 1) {
      for (let row = 0; row < 3; row += 1) elements[column * 4 + row] = pose.basis[column * 3 + row]! * shape.length;
      elements[column * 4 + 3] = 0;
    }
    elements[12] = pose.x;
    elements[13] = pose.y;
    elements[14] = pose.z;
    elements[15] = 1;
    bend.set(pose.strokePhase, pose.strokeAmplitude, pose.arch, pose.pectoral);
    uniforms.uPectoralRoot.value.set(shape.pectoral.root[1], shape.pectoral.root[2]);
    uniforms.uSpecies.value = pose.species;
    uniforms.uWhaleLength.value = shape.length;
    for (const item of [mesh, caster]) {
      if (!item) continue;
      item.geometry = geometry;
      item.matrixWorld.copy(mesh.matrix);
      item.matrix.copy(mesh.matrix);
      item.visible = true;
    }
  };

  const review = { hidden: false, updateMs: 0 };

  const hideBody = () => {
    mesh.visible = false;
    if (caster) caster.visible = false;
  };

  /** Advances the whale to `time` with the active camera (it only surfaces in that view). */
  const update = (
    time: number, camera: Camera, possessed: boolean, viewportHeight: number, windX: number, windZ: number
  ) => {
    const started = performance.now();
    view.setCamera(camera, possessed);
    const frame = director.update(time, view.whaleView, windX, windZ);
    if (frame.active) placeBody(frame, camera, viewportHeight);
    else hideBody();
    water.update(frame);
    if (review.hidden) {
      hideBody();
      for (const item of water.meshes) item.visible = false;
    }
    review.updateMs = performance.now() - started;
  };

  return {
    casters: caster ? [caster] : [],
    /** Review tools: the director's hooks, the pose, a hide switch (cost A/B), the last update's CPU ms. */
    debug: {
      ...director.debug,
      lastUpdateMs: () => review.updateMs,
      setHidden: (hidden: boolean) => (review.hidden = hidden),
      state: () => {
        const { pose } = director.frame;
        return { ...director.debug.state(), x: pose.x, y: pose.y, z: pose.z };
      }
    },
    meshes: [mesh, ...water.meshes],
    setEnabled: director.setEnabled,
    update
  };
};

export type ThreeWhales = ReturnType<typeof createThreeWhales>;

declare global {
  interface Window {
    /** Development only: start a whale event now, schedule the next one, read the state (review tools). */
    __whales?: ThreeWhales["debug"];
  }
}
