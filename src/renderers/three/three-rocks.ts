import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  GLSL3,
  Group,
  type IUniform,
  Mesh,
  RawShaderMaterial,
  RepeatWrapping,
  Vector3} from "three";

import {
  createMacroNormalPixels,
  NO_MACRO_NORMAL_PIXELS
} from "../../render-common/macro-normal-map";
import type {
  IslandRockMesh,
  IslandRocks,
  StoneGroup
} from "../../render-common/rocks/island-rocks";
import type { RockMeshData } from "../../render-common/rocks/rock-mesh";
import { createRockMeshRegistry } from "../../render-common/rocks/rock-mesh-registry";
import { SURFACE_COLOR_OUTPUT_GLSL } from "../../render-common/shaders/color-output-glsl";
import {
  COMMON_UNIFORMS_GLSL,
  FOG_OF_WAR_GLSL,
  LIGHTING_GLSL,
  NOISE_GLSL
} from "../../render-common/shaders/common-glsl";
import { PROP_FOG_GLSL } from "../../render-common/shaders/prop-glsl";
import {
  ROCK_DETAIL_GLSL,
  ROCK_FILL_GLSL,
  ROCK_SURFACE_GLSL
} from "../../render-common/shaders/rock-glsl";
import type { PaintedTexture } from "../../render-common/trees/atlas-canvas";
import type { WorldData } from "../../shared/world/world-data";
import { createAtlasTexture } from "./three-materials";
import { createThreeRockGrowth } from "./three-rock-growth";
import { SHADOW_NEAR_CASTER_LAYER, SUN_SHADOW_GLSL } from "./three-shadows";

const VERTEX_GLSL = `
precision highp float;
in vec3 position;
in vec3 normal;
in vec4 rockMask;
in vec4 rockExtra;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
out vec3 vWorld;
out vec3 vNormal;
out vec4 vMask;
out vec4 vExtra;

void main() {
  vWorld = position;
  vNormal = normal;
  vMask = rockMask;
  vExtra = rockExtra;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * Softer sun shadow on rock: the shared PCF sampled at five normal-offset points spread a little
 * over the surface (wider penumbra, no acne or jagged stair-steps on the smooth skin). The
 * offset (0.25) lifts the samples over the skin's own triangle facets, which otherwise shadow
 * each other in small dark polygons; shadows of real forms (ridges, peaks, trees) stay.
 */
const ROCK_SOFT_SHADOW_GLSL = `
float sampleSoftRockShadow(vec3 world, vec3 normal) {
  vec3 base = world + normal * 0.25;
  vec3 side = normalize(cross(normal, abs(normal.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 other = cross(normal, side);
  float lit = sampleSunShadow(base);
  lit += sampleSunShadow(base + side * 0.14) + sampleSunShadow(base - side * 0.14);
  lit += sampleSunShadow(base + other * 0.14) + sampleSunShadow(base - other * 0.14);
  return lit / 5.0;
}
`;

/** Soft sun highlight: fresh stone and damp recesses glint slightly, moss and gravel stay matte. */
const ROCK_SPECULAR_GLSL = `
vec3 getRockSpecular(vec3 normal, float roughness, float sunVisibility) {
  vec3 halfway = normalize(uSunDirection + uViewDirection);
  float gloss = 1.0 - roughness;
  float highlight = pow(max(dot(normal, halfway), 0.0), mix(6.0, 40.0, gloss));
  return uSunColor * highlight * gloss * gloss * 0.6 * sunVisibility * uHighlight;
}
`;

/** Where a tinted stone material appends its own close-up mineral detail. */
const STONE_DETAIL_MARKER = "// STONE_DEPOSIT_DETAIL";

/**
 * Sculpted rock with the island light: three blended cliff materials with detail normals (the
 * lite variant, ROCK_LITE, leaves them and the finer octaves out), roughness highlight, cavity
 * occlusion, sun shadow map, fog.
 */
const FRAGMENT_GLSL = `
precision highp float;
in vec3 vWorld;
in vec3 vNormal;
in vec4 vMask;
in vec4 vExtra;
out vec4 fragColor;
${COMMON_UNIFORMS_GLSL}
${NOISE_GLSL}
${LIGHTING_GLSL}
${FOG_OF_WAR_GLSL}
${PROP_FOG_GLSL}
${SUN_SHADOW_GLSL}
${ROCK_SURFACE_GLSL}
${ROCK_DETAIL_GLSL}
${ROCK_SPECULAR_GLSL}
${ROCK_FILL_GLSL}
${ROCK_SOFT_SHADOW_GLSL}
${SURFACE_COLOR_OUTPUT_GLSL}
#ifdef STONE_TINT
uniform vec3 uStoneTint;
#else
/** GROUND-PALETTE step 5: the island's rock palette (red sandstone, golden, limestone, basalt), like the ground rock. */
uniform vec3 uRockPropTint;
#endif

void main() {
  if (isHiddenByFog(vExtra.y, vWorld.xz)) discard;
#ifdef ROCK_LITE
  RockSurface rock = getRockSurface(vWorld, normalize(vNormal), vMask, vExtra);
#else
  RockSurface rock = getRockDetailSurface(vWorld, normalize(vNormal), vMask, vExtra);
#endif
#ifdef STONE_TINT
  // Stone material deposits: the boulder's own shading and texture detail in the material's colour.
  float shade = dot(rock.albedo, vec3(0.299, 0.587, 0.114));
  rock.albedo = uStoneTint * clamp(shade * 1.8, 0.4, 1.15);
  ${STONE_DETAIL_MARKER}
#else
  rock.albedo = min(rock.albedo * uRockPropTint, vec3(1.0));
#endif
  float sun = sampleSoftRockShadow(vWorld, normalize(vNormal));
  vec3 color = lightSurface(rock.albedo, rock.normal, sun, rock.occlusion, vWorld.xz)
    + getRockFill(rock.albedo, rock.normal, sun, rock.occlusion)
    + getRockSpecular(rock.normal, rock.roughness, sun) * rock.albedo;
  color *= getRockPlaneContrast(rock, sun);
  fragColor = vec4(finishSurface(applyFogOfWar(color, vExtra.y, vWorld.xz), vWorld), 1.0);
}
`;

const DEPTH_FRAGMENT_GLSL = `
precision highp float;
in vec3 vWorld;
in vec4 vExtra;
out vec4 fragColor;
${COMMON_UNIFORMS_GLSL}
${NOISE_GLSL}
${PROP_FOG_GLSL}
void main() {
  if (isHiddenByFog(vExtra.y, vWorld.xz)) discard;
  fragColor = vec4(1.0);
}
`;

export const toRockGeometry = (data: RockMeshData) => {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(data.positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(data.normals, 3));
  geometry.setAttribute("rockMask", new BufferAttribute(data.mask, 4, true));
  geometry.setAttribute("rockExtra", new BufferAttribute(data.extra, 4, true));
  geometry.setIndex(new BufferAttribute(data.indices.slice(), 1));
  geometry.computeBoundingSphere();
  return geometry;
};

const createRepeat = (pixels: Uint8Array, texture: PaintedTexture) => {
  const result = createAtlasTexture(pixels, texture.width, texture.height);
  result.wrapS = RepeatWrapping;
  result.wrapT = RepeatWrapping;
  return result;
};

/** The landform normals the rock's broad planes follow (uMacroNormals). */
export const createMacroNormalTexture = (world: WorldData) => {
  const { height, pixels, width } = createMacroNormalPixels(world);
  return createAtlasTexture(pixels, width, height);
};

/** After a map edit: the landform normals from the edited heights. */
export const refreshMacroNormalTexture = (texture: DataTexture, world: WorldData) => {
  (texture.image.data as Uint8Array).set(createMacroNormalPixels(world).pixels);
  texture.needsUpdate = true;
};

/** Scenes without a world: the rock keeps its own normals. */
const noMacroNormals = createAtlasTexture(NO_MACRO_NORMAL_PIXELS, 1, 1);

/**
 * The island's sculpted rock layer: one mesh per terrain chunk plus its sun shadow caster;
 * without `detail` (QualityPreset.rockDetail) the lite rock shader.
 */
export const createThreeRocks = (
  { chunks, count }: IslandRocks,
  uniforms: Record<string, IUniform>,
  texture: PaintedTexture,
  detail: boolean
) => {
  const rockUniforms = {
    uMacroNormals: { value: noMacroNormals },
    uRockPropTint: { value: new Vector3(1, 1, 1) },
    ...uniforms,
    uRockNormal: { value: createRepeat(texture.normal, texture) },
    uRockTexture: { value: createRepeat(texture.color, texture) }
  };
  const material = new RawShaderMaterial({
    defines: detail ? {} : { ROCK_LITE: "" },
    fragmentShader: FRAGMENT_GLSL,
    glslVersion: GLSL3,
    uniforms: rockUniforms,
    vertexShader: VERTEX_GLSL
  });
  const depth = new RawShaderMaterial({
    fragmentShader: DEPTH_FRAGMENT_GLSL,
    glslVersion: GLSL3,
    uniforms: rockUniforms,
    vertexShader: VERTEX_GLSL
  });
  const group = new Group();
  const casters = new Group();
  /** Rubble and pebbles in their own groups: hidden when zoomed out (distance LOD). */
  const smallRocks = new Group();
  const smallCasters = new Group();
  group.add(smallRocks);
  casters.add(smallCasters);
  /** Main and caster mesh by chunk and stone group (the map editor replaces them). */
  const registry = createRockMeshRegistry<Mesh>((mesh) => {
    mesh.removeFromParent();
    mesh.geometry.dispose();
  });
  const levels = new Map<BufferGeometry, { applied?: "coarse" | "full"; full: Uint32Array; coarse: Uint32Array; mesh: Mesh }>();
  let coarse = false;
  const applyLevel = (geometry: BufferGeometry, indices: Uint32Array) => {
    const index = geometry.getIndex()!;
    (index.array as Uint32Array).set(indices);
    index.needsUpdate = true;
    geometry.setDrawRange(0, indices.length);
  };
  let triangles = 0;
  const addMesh = ({ chunk, data, group: stones, small }: IslandRockMesh) => {
    const geometry = toRockGeometry(data);
    const main = new Mesh(geometry, material);
    const caster = new Mesh(geometry, depth);
    // World-space chunk geometry: no matrix to compose each frame. Rubble shadows are below a far
    // cascade texel, so only the detailed cascades and the single map draw them (R08).
    caster.matrixAutoUpdate = false;
    if (small) caster.layers.set(SHADOW_NEAR_CASTER_LAYER);
    if (data.lodIndices) {
      levels.set(geometry, { applied: coarse ? "coarse" : "full", full: data.indices, coarse: data.lodIndices, mesh: main });
      geometry.addEventListener("dispose", () => levels.delete(geometry));
      if (coarse) applyLevel(geometry, data.lodIndices);
    }
    (small ? smallRocks : group).add(main);
    (small ? smallCasters : casters).add(caster);
    triangles += data.triangles;
    registry.add(chunk, stones, main);
    registry.add(chunk, stones, caster);
  };
  chunks.forEach(addMesh);
  const growth = createThreeRockGrowth({ casters, group }, { depth, main: material }, toRockGeometry);
  const replaceStones = (stones: StoneGroup, ids: number[], meshes: IslandRockMesh[]) => {
    registry.remove(ids, stones);
    meshes.forEach(addMesh);
  };
  const replaceRockChunks = (ids: number[], meshes: IslandRockMesh[]) => {
    registry.remove(ids);
    meshes.forEach(addMesh);
  };
  const updateLod = (
    zoom: number,
    isIsoView: boolean,
    eye?: { x: number; z: number },
    distance = 55
  ) => {
    if (isIsoView) {
      const next = zoom < (coarse ? .72 : .58);
      if (next === coarse) return;
      coarse = next;
      levels.forEach((level, geometry) => {
        const applied = coarse ? "coarse" : "full";
        if (level.applied === applied) return;
        applyLevel(geometry, coarse ? level.coarse : level.full);
        level.applied = applied;
      });
      return;
    }
    if (!eye) {
      levels.forEach((level, geometry) => {
        if (level.applied === "full") return;
        applyLevel(geometry, level.full);
        level.applied = "full";
      });
      return;
    }
    levels.forEach((level, geometry) => {
      const sphere = level.mesh.geometry.boundingSphere;
      const far = sphere
        ? Math.max(0, Math.hypot(sphere.center.x - eye.x, sphere.center.z - eye.z) - sphere.radius) > distance
        : false;
      const applied = far ? "coarse" : "full";
      if (level.applied === applied) return;
      applyLevel(geometry, far ? level.coarse : level.full);
      level.applied = applied;
    });
  };
  /**
   * The same rock material recoloured (stone material deposits: boulder clusters per material).
   * `detail` appends close-up mineral structure after the flat tint (see stone-material-detail.ts);
   * `family` names that stone so the WebGPU TSL port can append the same detail.
   */
  const createTintedMaterial = (tint: readonly [number, number, number], detail = "",
    family?: string) => {
    const tinted = new RawShaderMaterial({
      defines: { ...material.defines, STONE_TINT: "" },
      fragmentShader: detail ? FRAGMENT_GLSL.replace(STONE_DETAIL_MARKER, () => detail) : FRAGMENT_GLSL,
      glslVersion: GLSL3,
      uniforms: { ...rockUniforms, uStoneTint: { value: new Color(...tint) } },
      vertexShader: VERTEX_GLSL
    });
    if (family !== undefined) tinted.userData.rockDepositFamily = family;
    return tinted;
  };
  const setSmallRocksVisible = (visible: boolean) => {
    smallRocks.visible = visible;
    smallCasters.visible = visible;
  };
  return {
    casters,
    count,
    createTintedMaterial,
    group,
    growStones: growth.grow,
    replaceRockChunks,
    replaceStones,
    setSmallRocksVisible,
    triangles,
    updateGrowth: growth.update,
    updateLod
  };
};
