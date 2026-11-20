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
  fwidth,
  If,
  length,
  max,
  min,
  mix,
  mod,
  normalize,
  sign,
  sin,
  smoothstep,
  sqrt,
  step,
  vec2,
  vec3,
  vec4
} from "three/tsl";

import {
  BARK_LICHEN,
  BIRCH_BARK,
  CONIFER_SCALES,
  type ConiferScaleKind,
  OAK_BARK,
  PALM_BARK
} from "../../../render-common/trees/bark-shading";
import { BARK_FAMILY, BARK_FAMILY_STRIDE, BARK_UV_OFFSET } from "../../../render-common/trees/bark-uv";

type TslNode = any; // TSL's generated types do not model the proxied node methods.
type NoiseNode = (point: TslNode) => TslNode;

const TAU = 6.2831853;
const LICHEN = vec3(...BARK_LICHEN);
const GREY_WEIGHTS = vec3(0.333);

/** Light of a bark surface: `lightSurface` (sun, SH9 sky, clouds, rain) and the ambient bounce. */
export interface BarkLight {
  /** uAmbientSky + uAmbientGround. */
  ambient: TslNode;
  lightSurface: (albedo: TslNode, normal: TslNode, sunVisibility: TslNode, occlusion: TslNode,
    xz: TslNode) => TslNode;
}

/** A bark lighting call: base albedo, geometric normal, uv, world position, sun visibility. */
type BarkShader = (base: TslNode, normal: TslNode, uv: TslNode, world: TslNode,
  sunVisibility: TslNode) => TslNode;

/** DERIVATIVE_BUMP_GLSL: surface-gradient bump from screen derivatives (no tangents). */
export const perturbDerivativeNormal = (position: TslNode, normal: TslNode, height: TslNode): TslNode => {
  const sigmaX = position.dFdx();
  const sigmaY = position.dFdy();
  const r1 = cross(sigmaY, normal);
  const r2 = cross(normal, sigmaX);
  const determinant = dot(sigmaX, r1);
  const gradient = r1.mul(height.dFdx()).add(r2.mul(height.dFdy())).mul(sign(determinant));
  return normalize(abs(determinant).mul(normal).sub(gradient));
};

/** World size of one bark unit (BARK_BUMP_GLSL `barkScale`). */
const barkScale = (bark: TslNode, world: TslNode): TslNode => {
  const worldStep = length(world.dFdx()).add(length(world.dFdy()));
  const barkStep = length(bark.dFdx()).add(length(bark.dFdy()));
  return worldStep.div(max(barkStep, 1e-5));
};

const lineDistance = (x: TslNode): TslNode => abs(fract(x.add(0.5)).sub(0.5));
const hash = (value: TslNode): TslNode => fract(sin(value.mul(127.1).add(31.7)).mul(43758.5453));

/** Noise wrapped seamlessly around the limb (around enters as a circle). */
const wrapPoint = (bark: TslNode, scale: TslNode): TslNode => {
  const angle = bark.x.mul(TAU);
  return vec2(cos(angle), sin(angle)).mul(scale);
};

/** Oak plates (TREE_SHADING_GLSL `barkPlates`): x height, y detail. */
const createOakBark = (valueNoise: NoiseNode, { ambient, lightSurface }: BarkLight): BarkShader => {
  const barkNoise = (bark: TslNode, scale: number, offset: number): TslNode =>
    valueNoise(wrapPoint(bark, scale).add(vec2(bark.y.mul(scale * 1.9), offset)));

  const barkPlates = (bark: TslNode): TslNode => {
    const warpA = barkNoise(bark, 0.8, 3.1).mul(0.9).add(barkNoise(bark, 2, 7).mul(0.3));
    const warpB = barkNoise(bark, 1.1, 11).mul(1.8);
    const xA = bark.x.mul(OAK_BARK.plates).add(warpA);
    const xB = bark.x.mul(OAK_BARK.plates).add(0.5).add(warpB);
    const present = smoothstep(0.45, 0.6, barkNoise(bark, 1.6, 17));
    const gap = min(lineDistance(xA), lineDistance(xB).add(float(1).sub(present).mul(0.5)));
    const plate = smoothstep(0.05, 0.17, gap);
    const rounded = mix(0.8, 1, sqrt(clamp(gap.div(0.35), 0, 1)));
    const column = floor(xA);
    const along = bark.y.mul(OAK_BARK.cracks).add(hash(column)).add(barkNoise(bark, 3, 23).mul(0.35));
    const crackDistance = abs(fract(along.add(0.5)).sub(0.5));
    const crackOn = step(0.25, hash(column.add(floor(along).mul(7.3))));
    const crack = float(1).sub(smoothstep(0.03, 0.1, crackDistance)).mul(crackOn);
    const height = plate.mul(rounded).mul(float(1).sub(crack.mul(0.6)));
    const detail = float(1).sub(smoothstep(0.22, 0.55, fwidth(xA)));
    return vec2(mix(OAK_BARK.meanHeight, height, detail), detail);
  };

  const barkAlbedo = (base: TslNode, height: TslNode, detail: TslNode, weathering: TslNode): TslNode => {
    const grey = vec3(dot(base, GREY_WEIGHTS));
    const top = mix(base, grey.mul(vec3(1.12, 1.1, 1.03)), 0.4).mul(weathering.mul(0.3).add(0.82));
    const side = base.mul(vec3(0.9, 0.64, 0.46));
    const bottom = base.mul(vec3(0.34, 0.29, 0.26));
    const plate = mix(side, top, smoothstep(0.72, 0.92, height));
    const albedo = mix(plate, bottom, float(1).sub(smoothstep(0.1, 0.4, height)));
    return mix(mix(side, top, 0.55).mul(0.9), albedo, detail);
  };

  return (base, normal, uv, world, sunVisibility) => {
    const bark = vec2(uv.x.negate().sub(BARK_UV_OFFSET), uv.y);
    const plates = barkPlates(bark);
    const height = plates.x;
    const bumped = perturbDerivativeNormal(world, normal,
      height.mul(OAK_BARK.depth).mul(barkScale(bark, world)));
    const north = smoothstep(0, 0.7, normal.z.negate());
    const patches = smoothstep(0.5, 0.72, barkNoise(bark, 3, 20));
    const tops = smoothstep(0.7, 0.95, height);
    const albedo = mix(barkAlbedo(base, height, plates.y, barkNoise(bark, 5, 29)),
      LICHEN.mul(dot(base, GREY_WEIGHTS)).mul(2), north.mul(patches).mul(tops).mul(0.3));
    const cavity = mix(0.6, 1, smoothstep(0, 0.3, height));
    return lightSurface(albedo, bumped, sunVisibility, cavity, world.xz)
      .add(albedo.mul(ambient).mul(0.12));
  };
};

/** Silver birch (BIRCH_BARK_GLSL): partial dark marks, lenticels, peeling, a rough base. */
const createBirchBark = ({ ambient, lightSurface }: BarkLight): BarkShader => {
  const birchHash = (p: TslNode): TslNode => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
  const birchNoise = (p: TslNode): TslNode => {
    const cell = floor(p) as TslNode;
    const f = fract(p) as TslNode;
    const smooth = f.mul(f).mul(float(3).sub(f.mul(2)));
    const bottom = mix(birchHash(cell), birchHash(cell.add(vec2(1, 0))), smooth.x);
    const top = mix(birchHash(cell.add(vec2(0, 1))), birchHash(cell.add(vec2(1, 1))), smooth.x);
    return mix(bottom, top, smooth.y);
  };
  const wrapNoise = (bark: TslNode, scale: readonly [number, number], offset: TslNode): TslNode =>
    birchNoise(wrapPoint(bark, scale[0]).add(vec2(bark.y.mul(scale[1]).add(offset), float(offset).mul(1.7))));
  const around = (a: TslNode, b: TslNode): TslNode => abs(fract(a.sub(b).add(0.5)).sub(0.5));

  const marks = (bark: TslNode, rows: number, seed: number, widths: readonly [number, number],
    thickness: number): TslNode => {
    const along = bark.y.mul(rows).add(wrapNoise(bark, [1.2, 0.7], seed).mul(0.35));
    const row = floor(along);
    const inRow = fract(along).sub(0.5);
    const present = step(birchHash(vec2(row, seed + 3.7)), 0.62);
    const width = birchHash(vec2(row, seed)).pow(3).mul(widths[1]).add(widths[0]);
    const reach = around(bark.x, birchHash(vec2(row, seed + 9.1))).div(width.mul(0.5));
    const edge = wrapNoise(bark, [7, 9], row.mul(3.1).add(seed));
    const lens = max(0, float(1).sub(reach.mul(reach)));
    const half = birchHash(vec2(row, seed + 1.3)).mul(0.8).add(0.6).mul(thickness).mul(lens)
      .mul(edge.mul(0.6).add(0.7));
    return float(1).sub(smoothstep(half.mul(0.6), half, abs(inRow)))
      .mul(smoothstep(1, 0.75, reach)).mul(present);
  };

  const lower = (bark: TslNode): TslNode => float(1).sub(smoothstep(0.4, 2.6,
    bark.y.add(wrapNoise(bark, [1.5, 1], 61).sub(0.5).mul(0.8))));

  const fissures = (bark: TslNode): TslNode => {
    const x = bark.x.mul(14).add(wrapNoise(bark, [1.6, 4], 71).mul(1.2));
    const broken = smoothstep(0.45, 0.7, wrapNoise(bark, [3, 9], 83));
    return float(1).sub(smoothstep(0.02, 0.07, abs(fract(x).sub(0.5)))).mul(broken);
  };

  const surface = (base: TslNode, bark: TslNode, lowerShare: TslNode): TslNode => {
    const markDetail = float(1).sub(smoothstep(0.3, 0.8, fwidth(bark.y.mul(BIRCH_BARK.markRows))));
    const fineDetail = float(1).sub(smoothstep(0.25, 0.6, fwidth(bark.y.mul(BIRCH_BARK.lenticelRows))));
    const rawMarks = max(marks(bark, BIRCH_BARK.markRows, 1, [0.15, 0.7], 0.12),
      marks(bark, BIRCH_BARK.markRows * 1.43, 5, [0.15, 0.45], 0.09).mul(0.85));
    const markShare = mix(0.12, rawMarks, markDetail);
    const lenticels = mix(0.05, marks(bark, BIRCH_BARK.lenticelRows, 11, [0.03, 0.08], 0.08), fineDetail);
    const peel = smoothstep(0.64, 0.72, wrapNoise(bark, [2.5, 11], 23));
    const grey = smoothstep(0.55, 0.85, wrapNoise(bark, [2, 1.6], 41));
    const patches = wrapNoise(bark, [5, 6], 53);
    const cracks = fissures(bark).mul(lowerShare).mul(lowerShare).mul(fineDetail);
    const peeled = base.mul(mix(vec3(1), vec3(1.04, 1, 0.92), peel.mul(0.6)));
    const pale = mix(peeled, vec3(dot(peeled, GREY_WEIGHTS)).mul(0.84), grey.mul(0.35));
    const rough = base.mul(vec3(0.6, 0.57, 0.53)).mul(patches.mul(0.3).add(0.8));
    const mossy = mix(mix(pale, rough, lowerShare.mul(patches.mul(0.3).add(0.3))),
      vec3(...BIRCH_BARK.moss).mul(patches.mul(0.4).add(0.8)),
      lowerShare.pow(3).mul(smoothstep(0.55, 0.8, patches)).mul(0.4));
    const markColor = mix(vec3(...BIRCH_BARK.mark), vec3(...BIRCH_BARK.markBrown), wrapNoise(bark, [4, 6], 31));
    const marked = mix(mix(mix(mossy, markColor, markShare.mul(0.9)),
      vec3(...BIRCH_BARK.markBrown).mul(1.3), lenticels.mul(0.55)), vec3(...BIRCH_BARK.mark), cracks.mul(0.6));
    const height = float(1).sub(markShare.mul(0.35)).sub(lenticels.mul(0.25)).sub(cracks.mul(0.8))
      .add(peel.mul(0.1)).sub(lowerShare.mul(patches).mul(0.2));
    return vec4(marked, height);
  };

  const familyStart = BARK_UV_OFFSET + BARK_FAMILY.birch * BARK_FAMILY_STRIDE;
  return (base, normal, uv, world, sunVisibility) => {
    const bark = vec2(uv.x.negate().sub(familyStart), uv.y);
    const result = surface(base, bark, lower(bark));
    const bumped = perturbDerivativeNormal(world, normal,
      result.a.mul(BIRCH_BARK.depth).mul(barkScale(bark, world)));
    const cavity = mix(0.8, 1, clamp(result.a, 0, 1));
    return lightSurface(result.rgb, bumped, sunVisibility, cavity, world.xz)
      .add(result.rgb.mul(ambient).mul(0.1));
  };
};

/** Bark family index of a wood uv (CONIFER_SHADING_GLSL `getBarkFamily`). */
export const barkFamilyOf = (uv: TslNode): TslNode =>
  floor(uv.x.negate().sub(BARK_UV_OFFSET).div(BARK_FAMILY_STRIDE));

/** Spruce scales / mountain pine blocks (CONIFER_BARK_GLSL). */
const createConiferBark = ({ ambient, lightSurface }: BarkLight): BarkShader => {
  const coniferHash = hash;
  const coniferNoise = (p: TslNode): TslNode => {
    const cell = floor(p) as TslNode;
    const f = fract(p) as TslNode;
    const smooth = f.mul(f).mul(float(3).sub(f.mul(2)));
    const at = (offset: TslNode) => coniferHash(dot(cell.add(offset), vec2(1, 57)));
    return mix(mix(at(vec2(0, 0)), at(vec2(1, 0)), smooth.x), mix(at(vec2(0, 1)), at(vec2(1, 1)), smooth.x),
      smooth.y);
  };
  const wrapNoise = (bark: TslNode, scale: number, offset: number): TslNode =>
    coniferNoise(wrapPoint(bark, scale).add(vec2(bark.y.mul(scale * 1.9), offset)));

  const scales = (bark: TslNode, kind: ConiferScaleKind, seed: number): TslNode => {
    const x = bark.x.mul(kind.columns).add(wrapNoise(bark, 0.9, seed).sub(0.5).mul(kind.warp * 2));
    const column = floor(x);
    const shift = coniferHash(column.add(seed)).mul(1.7).add(wrapNoise(bark, 2.5, seed + 5).mul(0.4));
    const y = bark.y.mul(kind.rows).add(shift);
    const row = floor(y);
    const across = smoothstep(0, kind.furrow, abs(fract(x.add(0.5)).sub(0.5)));
    const crack = smoothstep(0, kind.furrow * 0.7, float(0.5).sub(abs(fract(y).sub(0.5))));
    const jitter = vec2(coniferHash(column.mul(7.7).add(row)), coniferHash(row.mul(3.3).add(column))).sub(0.5);
    const local = vec2(fract(x).sub(0.5), fract(y).sub(0.5)).sub(jitter.mul(0.4));
    const rounded = float(1).sub(smoothstep(0.5 - kind.furrow, 0.62, length(local.mul(vec2(1, 1.15)))));
    const shape = mix(across.mul(crack), rounded, kind.round);
    const height = shape.mul(mix(0.85, 1, fract(y)))
      .mul(coniferHash(column.mul(3.1).add(row)).mul(0.22).add(0.78));
    const detail = float(1).sub(smoothstep(0.22, 0.55, fwidth(x).add(fwidth(y).mul(0.5))));
    return vec2(mix(0.7, height, detail) as TslNode, detail);
  };

  const albedoOf = (base: TslNode, pattern: TslNode, topTint: TslNode, furrowTint: TslNode,
    weathering: TslNode): TslNode => {
    const top = base.mul(topTint).mul(weathering.mul(0.28).add(0.86));
    const bottom = base.mul(furrowTint);
    return mix(mix(bottom, top, 0.62), mix(bottom, top, smoothstep(0.12, 0.55, pattern.x)), pattern.y);
  };

  const coniferSurface = Fn(([baseInput, barkInput, family]: [TslNode, TslNode, TslNode]) => {
    const base = baseInput.toVar();
    const bark = barkInput.toVar();
    const weathering = wrapNoise(bark, 5, 29).toVar();
    const result = vec4(0).toVar();
    If(family.equal(BARK_FAMILY.mountainPine), () => {
      const blocks = scales(bark, CONIFER_SCALES.mountain, 13);
      result.assign(vec4(albedoOf(base, blocks, vec3(1.18, 1.15, 1.12), vec3(0.45, 0.38, 0.34), weathering),
        blocks.x));
    }).Else(() => {
      const spruce = scales(bark, CONIFER_SCALES.spruce, 21);
      result.assign(vec4(albedoOf(base, spruce, vec3(1.08, 1.06, 1.04), vec3(0.58, 0.42, 0.35), weathering),
        spruce.x));
    });
    return result;
  });

  return (base, normal, uv, world, sunVisibility) => {
    const family = barkFamilyOf(uv);
    const bark = vec2(uv.x.negate().sub(BARK_UV_OFFSET).sub(family.mul(BARK_FAMILY_STRIDE)), uv.y);
    const surface = coniferSurface(base, bark, family);
    const depth = family.equal(BARK_FAMILY.mountainPine)
      .select(float(CONIFER_SCALES.mountain.depth), float(CONIFER_SCALES.spruce.depth));
    const bumped = perturbDerivativeNormal(world, normal, surface.a.mul(depth).mul(barkScale(bark, world)));
    const north = smoothstep(0, 0.7, normal.z.negate());
    const lichen = smoothstep(0.55, 0.75, wrapNoise(bark, 3, 20)).mul(north).mul(0.25);
    const albedo = mix(surface.rgb, LICHEN.mul(dot(base, GREY_WEIGHTS)).mul(2), lichen);
    const cavity = mix(0.7, 1, smoothstep(0, 0.35, surface.a));
    return lightSurface(albedo, bumped, sunVisibility, cavity, world.xz).add(albedo.mul(ambient).mul(0.12));
  };
};

/** Palm trunks (PALM_SHADING_GLSL): coconut rings, date palm leaf bases, fan palm fibres. */
const createPalmBark = (valueNoise: NoiseNode, { ambient, lightSurface }: BarkLight): BarkShader => {
  const barkNoise = (bark: TslNode, scale: number, offset: number): TslNode =>
    valueNoise(wrapPoint(bark, scale).add(vec2(bark.y.mul(scale * 1.9), offset)));
  const detailOf = (x: TslNode): TslNode => float(1).sub(smoothstep(0.25, 0.6, fwidth(x)));

  const rings = (bark: TslNode): TslNode => {
    const ring = bark.y.mul(1.7).add(barkNoise(bark, 0.7, 5).mul(0.4));
    const groove = float(1).sub(smoothstep(0.02, 0.09, abs(fract(ring).sub(0.5)).sub(0.38)));
    const wander = bark.x.mul(11).add(barkNoise(bark, 2, 9));
    const fissure = smoothstep(0.88, 1, abs(sin(wander.mul(3.1416))));
    const height = float(1).sub(groove.mul(0.75)).sub(fissure.mul(0.2)).sub(hash(floor(ring)).mul(0.12));
    return mix(0.8, height, detailOf(ring));
  };

  const leafBases = (bark: TslNode): TslNode => {
    const rowY = bark.y.mul(2.4).add(barkNoise(bark, 1, 13).mul(0.2));
    const grid = vec2(bark.x.mul(7).add(mod(floor(rowY), 2).mul(0.5)), rowY);
    const cell = fract(grid).sub(0.5);
    const diamond = abs(cell.x).mul(1.1).add(abs(cell.y));
    const tilt = hash(dot(floor(grid), vec2(1, 17)));
    const scale = smoothstep(0.55, 0.3, diamond).mul(tilt.mul(0.15).add(0.85));
    const lip = smoothstep(0.1, -0.2, cell.y).mul(0.15);
    return mix(0.6, scale.sub(lip), detailOf(grid.y));
  };

  const fibres = (bark: TslNode): TslNode => {
    const ring = vec2(cos(bark.x.mul(6.2832)), sin(bark.x.mul(6.2832)));
    const fine = valueNoise(ring.mul(7.6).add(vec2(0, bark.y.mul(2.5))));
    const strands = fine.mul(0.7).add(valueNoise(ring.mul(2.7).add(vec2(5, bark.y))).mul(0.3));
    const bands = float(1).sub(smoothstep(0, 0.12, abs(fract(bark.y.mul(0.9)).sub(0.5)).sub(0.36)).mul(0.4));
    return mix(0.65, strands.mul(bands), detailOf(bark.x.mul(48)));
  };

  const heightOf = Fn(([barkInput, family]: [TslNode, TslNode]) => {
    const bark = barkInput.toVar();
    const height = float(0).toVar();
    If(family.equal(BARK_FAMILY.palmRinged), () => { height.assign(rings(bark)); })
      .ElseIf(family.equal(BARK_FAMILY.palmLeafBase), () => { height.assign(leafBases(bark)); })
      .Else(() => { height.assign(fibres(bark)); });
    return height;
  });

  return (base, normal, uv, world, sunVisibility) => {
    const family = barkFamilyOf(uv);
    const bark = vec2(uv.x.negate().sub(BARK_UV_OFFSET).sub(family.mul(BARK_FAMILY_STRIDE)), uv.y);
    const height = heightOf(bark, family);
    const bumped = perturbDerivativeNormal(world, normal,
      height.mul(PALM_BARK.depth).mul(barkScale(bark, world)));
    const grain = barkNoise(bark, 4, 31).mul(0.12).add(0.94);
    const albedo = base.mul(mix(0.88, 1.12, height)).mul(grain).mul(PALM_BARK.lift);
    const cavity = mix(0.9, 1, smoothstep(0, 0.5, height));
    return lightSurface(albedo, bumped, sunVisibility, cavity, world.xz).add(albedo.mul(ambient).mul(0.25));
  };
};

export const createBarkShaders = (valueNoise: NoiseNode, light: BarkLight) => ({
  birch: createBirchBark(light),
  conifer: createConiferBark(light),
  oak: createOakBark(valueNoise, light),
  palm: createPalmBark(valueNoise, light)
});
