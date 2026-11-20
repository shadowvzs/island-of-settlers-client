import type { IUniform } from "three";
import {
  abs,
  clamp,
  cos,
  cross,
  dot,
  float,
  floor,
  Fn,
  fract,
  If,
  max,
  min,
  mix,
  mod,
  normalize,
  renderGroup,
  screenCoordinate,
  sin,
  texture,
  uniform,
  vec2,
  vec3,
  vec4
} from "three/tsl";
import { type Matrix4, type NodeBuilder, type Texture, type Vector2, type Vector3, type Vector4 } from "three/webgpu";

import { SUN_SHADOW_POISSON, SUN_SHADOW_TUNING } from "../../three/sun-shadow-glsl";
import { sunShadowAtlasOf } from "./sun-shadow-atlas";

type TslNode = any; // TSL's generated types do not model the proxied node methods.
type ShadowUniforms = Record<string, IUniform>;
type Copyable = Matrix4 | Vector2 | Vector3 | Vector4;

const {
  depthBias,
  depthRange,
  maxDepthBias,
  maxKernelTexels,
  minKernelTexels,
  penumbraPerUnit,
  shadowFloor
} = SUN_SHADOW_TUNING;

/**
 * Receiver uniforms refreshed once per render call from their WebGL source, shared by the material's
 * lookups. Not in the shared render group: its buffer was rebuilt (destroyed) while still bound once
 * the receivers added members, which lost the device (Three r186, C-1 first runs).
 */
/**
 * Copies of the WebGL values, refreshed by `syncSunShadowUniforms` (the presenter, every render). One
 * set per uniform source, shared by every receiver in the render group: no per-object upload (C-1
 * first bench: per-material object-group copies cost about 7 ms of CPU per frame in the town).
 */
const syncs = new Set<() => void>();

export const syncSunShadowUniforms = () => {
  for (const sync of syncs) sync();
};

const followScalar = (source: IUniform): TslNode => {
  const node: TslNode = uniform(Number(source.value)).setGroup(renderGroup);
  syncs.add(() => { node.value = Number(source.value); });
  return node;
};

const followCopy = (source: IUniform): TslNode => {
  const node: TslNode = uniform((source.value as Copyable).clone() as Vector4).setGroup(renderGroup);
  syncs.add(() => { (node.value as Copyable).copy(source.value as never); });
  return node;
};

interface ShadowInputs {
  atlas: TslNode;
  /** One tile's share of the atlas uv. */
  atlasScale: TslNode;
  /** x cascades, y blend band, z kernel border, w 1 for Poisson. */
  cascades: TslNode;
  matrices: TslNode[];
  slots: TslNode;
  texel: TslNode;
  texelWorld: TslNode;
  weight: TslNode;
}

const createInputs = (uniforms: ShadowUniforms, map: Texture): ShadowInputs => ({
  atlas: texture(sunShadowAtlasOf(map)),
  atlasScale: followCopy(uniforms.uShadowAtlas!),
  cascades: followCopy(uniforms.uShadowCascades!),
  matrices: [uniforms.uShadowMatrix!, uniforms.uShadowMatrix1!, uniforms.uShadowMatrix2!].map(followCopy),
  slots: followCopy(uniforms.uShadowSlots!),
  texel: followScalar(uniforms.uShadowTexel!),
  texelWorld: followCopy(uniforms.uShadowTexelWorld!),
  weight: followScalar(uniforms.uSunShadowWeight!)
});

/** `index` 0, 1 or 2 of three nodes (WGSL `select` has no matrices: callers pick vectors). */
const pick = (index: TslNode, values: readonly TslNode[]): TslNode =>
  index.equal(0).select(values[0], index.equal(1).select(values[1], values[2]));

/** `getShadowDepthSlope`: depth change per local uv of the receiver plane (sign-invariant to dFdy). */
const depthSlope = (dx: TslNode, dy: TslNode): TslNode => {
  const det = dx.x.mul(dy.y).sub(dx.y.mul(dy.x));
  const slope = vec2(dy.y.mul(dx.z).sub(dx.y.mul(dy.z)), dx.x.mul(dy.z).sub(dy.x.mul(dx.z))).div(det);
  return abs(det).lessThan(1e-12).select(vec2(0), slope);
};

/** `sunShadowEdge`: local uv distance to the nearest tile border minus the kernel border. */
const edgeOf = (projected: TslNode, border: TslNode): TslNode => {
  const inner: TslNode = min(projected.xy, float(1).sub(projected.xy));
  return min(inner.x, inner.y).sub(border);
};

interface CascadeTile {
  origin: TslNode;
  projected: TslNode;
  slope: TslNode;
  texelWorld: TslNode;
}

/**
 * One atlas depth at a WebGL (bottom-up) atlas uv. Node texture uvs start at the top row on both
 * backends (Three flips depth textures on WebGL2), so v is flipped: unflipped, every receiver read
 * the atlas mirrored about its centre and rock shadows landed metres down-sun (2026-11-18).
 * WebGPU samples an explicit level (taps run in non-uniform control flow); Three r186's GLSL
 * `textureLod` of a depth texture misses the `.x` its `texture()` gets (a vec4 assigned to a float:
 * every receiver failed to compile on the WebGL2 backend), so that backend samples with plain
 * `texture()`: the atlas is nearest-filtered and has one level.
 */
const sampleAtlasDepth = (atlas: TslNode, uv: TslNode): TslNode => {
  const flipped = vec2(uv.x, float(1).sub(uv.y));
  return Fn((_inputs: unknown, builder: NodeBuilder) =>
    ((builder.renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true
      ? atlas.sample(flipped).level(0) : atlas.sample(flipped)))();
};

/** The PCF and Poisson filters of SUN_SHADOW_GLSL over one cascade tile. */
const createFilters = (inputs: ShadowInputs) => {
  const { atlas, atlasScale, texel } = inputs;
  const depthAt = (tile: CascadeTile, offset: TslNode): TslNode =>
    sampleAtlasDepth(atlas, tile.origin.add(tile.projected.xy.add(offset.mul(texel)).mul(atlasScale)));
  const biasOf = (tile: CascadeTile, offset: TslNode): TslNode =>
    min(tile.slope.dot(abs(offset).add(1)).add(depthBias), float(maxDepthBias));
  const tap = (tile: CascadeTile, offset: TslNode): TslNode =>
    tile.projected.z.sub(biasOf(tile, offset)).greaterThan(depthAt(tile, offset)).select(float(0), float(1));

  const pcf = (tile: CascadeTile): TslNode => {
    let lit: TslNode = float(0);
    for (let y = -1; y <= 1; y++)
      for (let x = -1; x <= 1; x++) lit = lit.add(tap(tile, vec2(x, y)));
    return lit.div(9);
  };

  /** Rotated Poisson-12 with the contact-hardening radius from four blocker search taps. */
  const poisson = (tile: CascadeTile, angle: TslNode): TslNode => {
    const c = cos(angle);
    const s = sin(angle);
    const spun = ([x, y]: readonly [number, number], radius: TslNode): TslNode =>
      vec2(c.mul(x).sub(s.mul(y)), s.mul(x).add(c.mul(y))).mul(radius);
    let blockerDepth: TslNode = float(0);
    let blockers: TslNode = float(0);
    for (let index = 0; index < SUN_SHADOW_POISSON.length; index += 3) {
      const offset = spun(SUN_SHADOW_POISSON[index]!, float(maxKernelTexels));
      const depth = depthAt(tile, offset);
      const blocked = depth.lessThan(tile.projected.z.sub(biasOf(tile, offset))).select(float(1), float(0));
      blockerDepth = blockerDepth.add(depth.mul(blocked));
      blockers = blockers.add(blocked);
    }
    const gap = blockers.greaterThan(0)
      .select(tile.projected.z.sub(blockerDepth.div(max(blockers, 1))).mul(depthRange), float(0));
    const radius = clamp(gap.mul(penumbraPerUnit).div(tile.texelWorld), minKernelTexels, maxKernelTexels);
    let lit: TslNode = float(0);
    for (const point of SUN_SHADOW_POISSON) lit = lit.add(tap(tile, spun(point, radius)));
    return lit.div(SUN_SHADOW_POISSON.length);
  };

  /** `sunShadowCascade`: Poisson on High (uShadowCascades.w), PCF otherwise. */
  return (tile: CascadeTile, angle: TslNode): TslNode => {
    const lit: TslNode = float(1).toVar();
    If(inputs.cascades.w.greaterThan(0.5), () => { lit.assign(poisson(tile, angle)); })
      .Else(() => { lit.assign(pcf(tile)); });
    return lit;
  };
};

/**
 * TSL twin of SUN_SHADOW_GLSL `sampleSunShadow` (three/sun-shadow-glsl.ts): the first cascade whose
 * tile holds the point, blended into the next across the band; the receiver-plane depth bias from
 * world derivatives; the shadow floor and the map strength. Inlined per call: a `setLayout` WGSL
 * helper mixed up the uniforms it reads with the material's own (Three r186: wrong `nodeUniform0`).
 */
const createLookup = (inputs: ShadowInputs) => {
  const { cascades, matrices, slots } = inputs;
  const filter = createFilters(inputs);
  const tileAt = (index: TslNode, projected: TslNode[], worldDx: TslNode, worldDy: TslNode) => {
    const dx = pick(index, matrices.map(matrix => matrix.mul(vec4(worldDx, 0)).xyz));
    const dy = pick(index, matrices.map(matrix => matrix.mul(vec4(worldDy, 0)).xyz));
    const slot = pick(index, [slots.x, slots.y, slots.z]);
    return {
      origin: vec2(mod(slot, slots.w), floor(slot.div(slots.w))).mul(inputs.atlasScale),
      projected: pick(index, projected),
      slope: abs(depthSlope(dx, dy)).mul(inputs.texel),
      texelWorld: pick(index, [inputs.texelWorld.x, inputs.texelWorld.y, inputs.texelWorld.z])
    };
  };

  return Fn(([world, angle]: [TslNode, TslNode]) => {
    const worldDx = world.dFdx().toVar();
    const worldDy = world.dFdy().toVar();
    const count = floor(cascades.x.add(0.5));
    const projected = matrices.map(matrix => matrix.mul(vec4(world, 1)).xyz.toVar());
    const edges = projected.map(point => edgeOf(point, cascades.z).toVar());
    // The first cascade whose tile holds the point (-1: none). A select chain, not `If` assignments:
    // those left the index at -1 in the generated WGSL.
    const holds = (cascade: number) => count.greaterThan(cascade).and(edges[cascade]!.greaterThanEqual(0));
    const index = holds(0).select(float(0), holds(1).select(float(1), holds(2).select(float(2), float(-1)))).toVar();
    const visibility = float(1).toVar();
    If(index.greaterThanEqual(0), () => {
      const lit = filter(tileAt(index, projected, worldDx, worldDy), angle).toVar();
      const blend = count.equal(1).select(float(1), clamp(pick(index, edges).div(cascades.y), 0, 1));
      If(blend.lessThan(1), () => {
        const next = index.add(1);
        const nextLit = float(1).toVar();
        If(next.lessThan(count).and(pick(next, edges).greaterThanEqual(0)), () => {
          nextLit.assign(filter(tileAt(next, projected, worldDx, worldDy), angle));
        });
        lit.assign(mix(nextLit, lit, blend));
      });
      visibility.assign(mix(1, mix(shadowFloor, 1, lit), inputs.weight));
    });
    return visibility;
  });
};

/** The Poisson rotation of SUN_SHADOW_GLSL (gl_FragCoord there; only the noise pattern differs). */
const poissonAngle = (): TslNode =>
  fract(fract(dot(screenCoordinate.xy, vec2(0.06711056, 0.00583715))).mul(52.9829189)).mul(6.2831853);

export interface SunShadowReceiver {
  /** `sampleSunShadow(world)`: the sun's visibility 0..1 with the floor and strength applied. */
  sample: (world: TslNode) => TslNode;
  /** `sampleSoftRockShadow` (three-rocks.ts): five lookups spread over the rock skin. */
  sampleSoft: (world: TslNode, normal: TslNode) => TslNode;
}

const inputsBySource = new WeakMap<IUniform, ShadowInputs>();

const inputsOf = (uniforms: ShadowUniforms, map: Texture) => {
  const key = uniforms.uShadowMatrix!;
  const known = inputsBySource.get(key);
  if (known !== undefined) return known;
  const inputs = createInputs(uniforms, map);
  inputsBySource.set(key, inputs);
  return inputs;
};

const createReceiver = (uniforms: ShadowUniforms, map: Texture): SunShadowReceiver => {
  const inputs = inputsOf(uniforms, map);
  const lookup = createLookup(inputs);
  const sample = (world: TslNode): TslNode => lookup(world, poissonAngle());
  const sampleSoft = (world: TslNode, normal: TslNode): TslNode => {
    const base = world.add(normal.mul(0.25));
    const side = normalize(cross(normal, abs(normal.y).lessThan(0.9).select(vec3(0, 1, 0), vec3(1, 0, 0))));
    const other = cross(normal, side);
    return sample(base).add(sample(base.add(side.mul(0.14)))).add(sample(base.sub(side.mul(0.14))))
      .add(sample(base.add(other.mul(0.14)))).add(sample(base.sub(other.mul(0.14)))).div(5);
  };
  return { sample, sampleSoft };
};

/** The renderer's shadow uniforms (three-shadows.ts), registered by the presenter before any port. */
let canonical: ShadowUniforms | null = null;

/**
 * The presenter registers the live shadow uniforms: the receivers bind to these, not to whatever
 * copy a material's own uniform record holds (the WebGPU terrain read a stale copy: identity matrix).
 */
export const setSunShadowUniforms = (uniforms: ShadowUniforms | null) => { canonical = uniforms; };

/**
 * The sun shadow lookup of one node-renderer receiver material (shared uniforms, the lookup inlined
 * per material: a `setLayout` WGSL helper mixed up the uniforms it read, Three r186). Null
 * when the pass is off (Detail setting) or no shadow uniforms exist: no lookup is compiled.
 */
export const sunShadowReceiverOf = (uniforms: ShadowUniforms | undefined): SunShadowReceiver | null => {
  const source = canonical ?? uniforms;
  const map = source?.uShadowMap?.value as Texture | null | undefined;
  if (source?.uShadowMatrix === undefined || !map || Number(source.uSunShadows?.value ?? 0) < 0.5) return null;
  return createReceiver(source, map);
};

/** `sampleSunShadow(world)`, or fully lit when the material has no sun shadow uniforms. */
export const sunShadowAt = (uniforms: ShadowUniforms | undefined, world: TslNode): TslNode =>
  sunShadowReceiverOf(uniforms)?.sample(world) ?? float(1);
