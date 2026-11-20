import {
  BufferAttribute,
  BufferGeometry,
  GLSL3,
  type IUniform,
  Mesh,
  RawShaderMaterial,
  Sphere,
  Vector3
} from "three";

import { createIceFloeMesh, type IceFloeMeshData } from "../../render-common/ice-floe-geometry";
import {
  createIceFloeOpenings,
  type IceFloeOpenings,
  type IceFloeOpeningsFrame
} from "../../render-common/ice-floe-openings";
import { type IceFloe, placeIceFloes } from "../../render-common/ice-floe-placement";
import type { QualityPreset } from "../../render-common/quality";
import { SURFACE_COLOR_OUTPUT_GLSL } from "../../render-common/shaders/color-output-glsl";
import {
  COMMON_UNIFORMS_GLSL,
  FOG_OF_WAR_GLSL,
  LIGHTING_GLSL,
  NOISE_GLSL
} from "../../render-common/shaders/common-glsl";
import { ICE_FLOE_SHADING_GLSL, ICE_FLOE_VERTEX_GLSL } from "../../render-common/shaders/ice-floe-glsl";
import { PROP_FOG_GLSL } from "../../render-common/shaders/prop-glsl";
import type { SnowMap } from "../../render-common/snow-map";
import type { WorldData } from "../../shared/world/world-data";
import { SUN_SHADOW_GLSL } from "./three-shadows";

/** Bytes of kept-open water (ice-floe-openings.ts) from which a floe leaves the mesh. */
const OPENING_THRESHOLD = 24;

const FRAGMENT_GLSL = `
precision highp float;
in vec3 vWorld;
in vec3 vNormal;
in vec4 vIce;
uniform vec3 cameraPosition;
out vec4 fragColor;
${COMMON_UNIFORMS_GLSL}
${NOISE_GLSL}
${LIGHTING_GLSL}
${FOG_OF_WAR_GLSL}
${PROP_FOG_GLSL}
${SUN_SHADOW_GLSL}
${SURFACE_COLOR_OUTPUT_GLSL}
${ICE_FLOE_SHADING_GLSL}

void main() {
  if (isHiddenByFog(1.0, vWorld.xz)) discard;
  vec3 view = normalize(cameraPosition - vWorld);
  // Seabed capture: only the submerged foot, marked like a fish (alpha 0.25 .. 0.65 = share of the
  // column above it), so the water shows it with a gentle wobble instead of shredding it.
  if (colorIsLinearCapture()) {
    if (vIce.y > 0.0) discard;
    fragColor = vec4(shadeIceUnderwater(vIce.y, view, vWorld.xz), getIceUnderwaterColumn(vIce.y, view));
    return;
  }
  float sunVisibility = sampleSunShadow(vWorld + vec3(0.0, 0.04, 0.0));
  vec3 normal = getIceReliefNormal(normalize(vNormal), vWorld.xz);
  float snow = getIceSnow(vWorld.xz, vIce.x, vIce.z);
  vec3 albedo = getIceAlbedo(vWorld.xz, normal, vIce, snow);
  float topness = smoothstep(0.5, 0.88, normal.y);
  vec3 color = lightSurface(albedo, normal, sunVisibility, 1.0, vWorld.xz)
    + getIceTransmission(normal, view, topness, vWorld.xz) * albedo
    + getIceSpecular(vWorld.xz, normal, view, snow, sunVisibility);
  color = keepIceCold(color, topness);
  fragColor = vec4(finishSurface(applyFogOfWar(color, 1.0, vWorld.xz), vWorld), 1.0);
}
`;

const DEPTH_FRAGMENT_GLSL = `
precision highp float;
in vec3 vWorld;
out vec4 fragColor;
${COMMON_UNIFORMS_GLSL}
${NOISE_GLSL}
${PROP_FOG_GLSL}
void main() {
  if (isHiddenByFog(1.0, vWorld.xz)) discard;
  fragColor = vec4(1.0);
}
`;

/** Positions are floe-relative (the shader places them): the bounds come from the floe centres. */
const getFloeBounds = (floes: readonly IceFloe[]) => {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const { radius, x, z } of floes) {
    minX = Math.min(minX, x - radius);
    maxX = Math.max(maxX, x + radius);
    minZ = Math.min(minZ, z - radius);
    maxZ = Math.max(maxZ, z + radius);
  }
  const center = new Vector3((minX + maxX) / 2, floes[0]?.surface ?? 0, (minZ + maxZ) / 2);
  return new Sphere(center, Math.hypot(maxX - minX, maxZ - minZ) / 2 + 2);
};

const createGeometry = (data: IceFloeMeshData, floes: readonly IceFloe[]) => {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(data.positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(data.normals, 3));
  geometry.setAttribute("iceCenter", new BufferAttribute(data.centers, 4));
  geometry.setAttribute("iceData", new BufferAttribute(data.ice, 4));
  geometry.setIndex(new BufferAttribute(data.indices.slice(), 1));
  geometry.boundingSphere = getFloeBounds(floes);
  return geometry;
};

const createFloeMaterial = (uniforms: Record<string, IUniform>, fragmentShader: string, seasonIce: boolean) =>
  new RawShaderMaterial({
    defines: seasonIce ? { SEASON_ICE: "" } : {},
    fragmentShader, glslVersion: GLSL3, uniforms, vertexShader: ICE_FLOE_VERTEX_GLSL
  });

/** Kept-open water 0..1 at a point; outside the map counts as open. */
const createOpenSampler = (openings: IceFloeOpenings) => (x: number, z: number) => {
  const cellX = Math.floor(x), cellZ = Math.floor(z);
  if (cellX < 0 || cellZ < 0 || cellX >= openings.width || cellZ >= openings.height) return 1;
  return openings.pixels[cellZ * openings.width + cellX]! / 255;
};

/** True when kept-open water reaches into the floe's outline. */
const isFloeInOpening = (floe: IceFloe, openings: IceFloeOpenings) => {
  const reach = Math.ceil(floe.radius);
  const baseX = Math.floor(floe.x), baseZ = Math.floor(floe.z);
  for (let z = Math.max(0, baseZ - reach); z <= Math.min(openings.height - 1, baseZ + reach); z++)
    for (let x = Math.max(0, baseX - reach); x <= Math.min(openings.width - 1, baseX + reach); x++) {
      if (Math.hypot(x + 0.5 - floe.x, z + 0.5 - floe.z) > floe.radius + 0.5) continue;
      if (openings.pixels[z * openings.width + x]! > OPENING_THRESHOLD) return true;
    }
  return false;
};

/**
 * Leaves floes that kept-open water reached out of the index buffer (openings only grow, so a
 * hidden floe never returns). Runs only when the openings changed.
 */
const createOpeningCuller = (
  geometry: BufferGeometry, data: IceFloeMeshData, floes: readonly IceFloe[], openings: IceFloeOpenings
) => {
  const hidden = new Uint8Array(floes.length);
  const rebuildIndex = () => {
    const index = geometry.getIndex()!;
    const target = index.array as Uint32Array;
    let length = 0;
    for (let floe = 0; floe < floes.length; floe++) {
      if (hidden[floe]) continue;
      const start = data.ranges[floe * 2]!, count = data.ranges[floe * 2 + 1]!;
      target.set(data.indices.subarray(start, start + count), length);
      length += count;
    }
    index.needsUpdate = true;
    geometry.setDrawRange(0, length);
  };
  return () => {
    let changed = false;
    floes.forEach((floe, index) => {
      if (hidden[index] || !isFloeInOpening(floe, openings)) return;
      hidden[index] = 1;
      changed = true;
    });
    if (changed) rebuildIndex();
  };
};

export interface ThreeIceFloes {
  /** Depth caster for the sun shadow scene. */
  caster: Mesh;
  dispose: () => void;
  floes: number;
  mesh: Mesh;
  triangles: number;
  /** Stamps the frame's harbours, vessels and fishing spots; floes in newly opened water leave. */
  update: (frame: IceFloeOpeningsFrame) => void;
}

/**
 * Real 3D floes on the calm shallow nearshore water of winter areas: one merged static mesh (one
 * draw, one caster draw, one seabed-capture draw for the submerged foot). Null when the world
 * has no ice belt. seasonIce: the floes grow and melt with the global season's ice ramp (SEASON_ICE).
 */
export const createThreeIceFloes = (
  world: WorldData, winter: (x: number, z: number) => number, uniforms: Record<string, IUniform>,
  seasonIce = false
): ThreeIceFloes | null => {
  const openings = createIceFloeOpenings(world);
  const floes = placeIceFloes(world, { open: createOpenSampler(openings), winter });
  if (floes.length === 0) return null;
  const data = createIceFloeMesh(floes);
  const geometry = createGeometry(data, floes);
  const material = createFloeMaterial(uniforms, FRAGMENT_GLSL, seasonIce);
  const depth = createFloeMaterial(uniforms, DEPTH_FRAGMENT_GLSL, seasonIce);
  const mesh = new Mesh(geometry, material);
  const caster = new Mesh(geometry, depth);
  mesh.matrixAutoUpdate = false;
  caster.matrixAutoUpdate = false;
  const cullOpenings = createOpeningCuller(geometry, data, floes, openings);
  return {
    caster,
    dispose: () => {
      geometry.dispose();
      material.dispose();
      depth.dispose();
    },
    floes: floes.length,
    mesh,
    triangles: data.triangles,
    update: frame => {
      if (openings.update(frame)) cullOpenings();
    }
  };
};

const FULL_WINTER = () => 1;

/**
 * Whether the scene builds ice floes: winter maps (theme snow areas, or everywhere under the
 * cosmetic winter or while the global season can snow) where the preset allows them
 * (QualityPreset.iceFloes, the "Ice floes" setting).
 */
export const hasIceFloeScene = (
  { iceFloes }: Pick<QualityPreset, "iceFloes">, snowMap: Pick<SnowMap, "hasSnow" | "seasonSnow">,
  visualWinter: boolean
) => iceFloes && (snowMap.hasSnow || visualWinter || snowMap.seasonSnow === true);

/**
 * The scene's floes, or null (nothing built, nothing drawn) where hasIceFloeScene is false. While the global season
 * can snow the floes are placed for the full winter and follow its ice ramp (seasons-5), so they no longer appear at
 * the mid-transition rebuild.
 */
export const createRendererIceFloes = (
  world: WorldData, snowMap: SnowMap, uniforms: Record<string, IUniform>,
  quality: Pick<QualityPreset, "iceFloes">, visualWinter: boolean
) => {
  if (!hasIceFloeScene(quality, snowMap, visualWinter)) return null;
  const seasonIce = snowMap.seasonSnow === true;
  const winter = visualWinter || seasonIce ? FULL_WINTER : snowMap.sample;
  return createThreeIceFloes(world, winter, uniforms, seasonIce);
};
