import {
  abs, attribute, cos, dot, float, floor, fwidth, ivec2, length, max, mix, sin, smoothstep, texture,
  textureLoad, uv, vec2
} from "three/tsl";
import { type Material, MeshStandardNodeMaterial, type Texture } from "three/webgpu";

import { TRAFFIC_WEAR_TUNING } from "../../../render-common/traffic-wear-tuning";
import { SunShadowedStandardNodeMaterial } from "./sun-shadow-lighting";

type TslNode = any; // TSL's generated types do not model the proxied node methods.
type CopyTexture = (texture: Texture | null | undefined) => Texture | undefined;

interface RoadRuts {
  uTrafficWear: { value?: Texture };
}

interface RoadSource extends Material {
  bumpMap?: Texture;
  bumpScale?: number;
  map?: Texture;
  userData: { roadRuts?: RoadRuts; roadTier?: string; sunShadowReceiver?: boolean };
}

const WEAR = TRAFFIC_WEAR_TUNING;
const TEXELS = WEAR.texelsPerCell;

/** Pure wheel-contact share of one stored cart line (CPU/GPU parity case). */
export const trafficWheelTrack = (signed: TslNode, halfWidth: TslNode, soft: TslNode): TslNode => {
  const wheel = abs(abs(signed).sub(WEAR.wheelHalfGauge)) as TslNode;
  return float(1).sub(smoothstep(halfWidth.sub(soft), halfWidth.add(soft), wheel)) as TslNode;
};

const textureSizeOf = (texture: Texture | undefined): readonly [number, number] => {
  const image = texture?.image as { height?: number; width?: number } | undefined;
  return [Math.max(1, image?.width ?? 1), Math.max(1, image?.height ?? 1)];
};

/** TSL twin of TRAFFIC_WEAR_FIELD_GLSL / TRAFFIC_RUT_GLSL / TRAFFIC_PAVED_GROOVE_GLSL. */
const createTrafficShade = (traffic: Texture, tier: string, size: readonly [number, number]): TslNode => {
  const dimensions = vec2(size[0], size[1]) as TslNode;
  const world = uv() as TslNode;
  const field = texture(traffic, world.mul(TEXELS).div(dimensions)) as TslNode;
  const paved = tier !== "dirt";
  const start = paved ? WEAR.pavedGrooveStart : WEAR.rutStart;
  const full = paved ? WEAR.pavedGrooveFull : WEAR.rutFull;
  const strength = paved ? WEAR.pavedGrooveStrength : WEAR.rutStrength;
  const halfWidth = float(paved ? WEAR.pavedGrooveWidth : WEAR.rutHalfWidth);
  const wear = smoothstep(start, full, field.g) as TslNode;
  // GLSL trafficWearCell clamps the texel fetch to the field's last row/column.
  const cell = floor(world.mul(TEXELS)).clamp(0, vec2(size[0] - 1, size[1] - 1)) as TslNode;
  const line = textureLoad(traffic, ivec2(cell)) as TslNode;
  const hasLine = line.a.greaterThan(0.5 / 255) as TslNode;
  const angle = line.b.mul(255).add(0.5).mul(Math.PI / 256) as TslNode;
  const direction = vec2(cos(angle), sin(angle)) as TslNode;
  const offset = line.a.mul(255).sub(1).div(127).sub(1).mul(WEAR.lineOffsetRange) as TslNode;
  const local = world.sub(cell.add(0.5).div(TEXELS)) as TslNode;
  const signed = dot(local, vec2(direction.y.negate(), direction.x)).sub(offset) as TslNode;
  const soft = max(0.012, length(fwidth(world)).mul(0.6)) as TslNode;
  const track = trafficWheelTrack(signed, halfWidth, soft);
  return hasLine.select(float(1).sub(wear.mul(strength).mul(track)), float(1)) as TslNode;
};

/**
 * TSL road material: the current road map/vertex-alpha surface plus the actual traffic-wear field
 * (dirt ruts and paved grooves). The WebGL material keeps its `onBeforeCompile`; this is the node twin.
 */
export const createTslRoadMaterial = (sourceMaterial: Material, copyTexture: CopyTexture,
  sunVisibility: TslNode | null = null): Material | null => {
  const source = sourceMaterial as RoadSource;
  const tier = source.userData.roadTier;
  if (tier === undefined) return null;
  const map = copyTexture(source.map) ?? source.map;
  if (map == null) return null;
  const traffic = source.userData.roadRuts?.uTrafficWear?.value;
  const size = textureSizeOf(traffic);
  const color = attribute("color", "vec4") as TslNode;
  // `loadRoadSoilMaterial` replaces the baked dirt map/relief after the images load; the sample
  // node keeps that texture reference so the sync below swaps it without rebuilding the graph.
  const mapNode = texture(map, uv()) as TslNode;
  const sampled = mapNode as TslNode;
  const base = sampled.rgb.mul(color.rgb) as TslNode;
  const shade = traffic !== undefined
    ? createTrafficShade(traffic, tier, size)
    : float(1) as TslNode;
  const parameters = {
    alphaTest: source.alphaTest,
    bumpMap: copyTexture(source.bumpMap) ?? source.bumpMap ?? undefined,
    bumpScale: source.bumpScale ?? 1,
    depthTest: source.depthTest,
    depthWrite: false,
    metalness: 0,
    roughness: (source as { roughness?: number }).roughness ?? 0.9,
    side: source.side,
    transparent: true
  };
  const shadowed = sunVisibility !== null && source.userData.sunShadowReceiver === true;
  const material = shadowed ? new SunShadowedStandardNodeMaterial(parameters)
    : new MeshStandardNodeMaterial(parameters);
  if (shadowed) (material as SunShadowedStandardNodeMaterial).sunVisibility = sunVisibility;
  material.name = `tsl:road-${tier}`;
  material.colorNode = base.mul(shade) as TslNode;
  // The WebGL shader feathers the map's own alpha into the verge with the road's vertex alpha.
  material.opacityNode = mix(sampled.a, 1, smoothstep(0.1, 0.9, color.a)) as TslNode;
  material.userData.wg4Ported = true;
  material.userData.syncUniforms = () => {
    const latestMap = copyTexture(source.map) ?? source.map;
    if (latestMap != null && mapNode.value !== latestMap) mapNode.value = latestMap;
    const latestBump = copyTexture(source.bumpMap) ?? source.bumpMap ?? null;
    if (material.bumpMap !== latestBump) {
      material.bumpMap = latestBump;
      material.needsUpdate = true;
    }
  };
  return material;
};

export const isRoadMaterial = (material: Material): boolean =>
  (material as RoadSource).userData?.roadTier !== undefined;
