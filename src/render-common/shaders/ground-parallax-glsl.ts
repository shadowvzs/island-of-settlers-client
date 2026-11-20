import { MATERIAL } from "../../shared/world/world-data";
import { MATERIAL_TILE_SIZE } from "../materials/material-textures";

/**
 * Relief layers of the R14c parallax and the share of PARALLAX_DEPTH their hollows reach: footpath
 * dirt, sand ripples, gravel and the mine gravel. Grass, forest floor, rock and snow keep the flat
 * mapping (their depth comes from the T07 grass ring, rock meshes and the snow tint).
 */
export const PARALLAX_LAYER_DEPTHS: Readonly<Partial<Record<keyof typeof MATERIAL, number>>> = {
  dirt: 0.7,
  gravel: 1,
  mine: 1,
  sand: 0.55
};

const reliefLayers = Object.entries(PARALLAX_LAYER_DEPTHS).map(([name, depth]) => ({
  depth: depth!,
  layer: MATERIAL[name as keyof typeof MATERIAL]
}));
if (reliefLayers.length !== 4) throw new Error("the ground parallax packs four relief weights");

/**
 * The relief layers' weights as one vec4 for getGroundParallax (constant indices: no array copy or
 * dynamic indexing in the full ground shader).
 */
export const PARALLAX_RELIEF_WEIGHTS_GLSL =
  `vec4(${reliefLayers.map(({ layer }) => `weights[${layer}]`).join(", ")})`;

const reliefLayerGlsl = reliefLayers
  .map(({ depth, layer }, index) => `  considerParallaxLayer(pick, reliefWeights[${index}], ParallaxLayer(` +
    `groundLayer(${layer}), materialScale(${layer}), ${depth.toFixed(3)}, layerTurn(${layer})));`)
  .join("\n");

/**
 * R14c possessed parallax occlusion mapping (needs GROUND_LAYERS_GLSL and the full ground's
 * materialScale, groundLayer and layerTurn). High only: the GROUND_PARALLAX define comes
 * from `QualityPreset.groundParallax`; without it this block compiles to nothing.
 *
 * The tiles are projected top down, so the height field is displaced along world up: the view ray
 * marches from the crest (albedo.a = 1) down to PARALLAX_DEPTH below it in 4–8 linear steps with a
 * final linear refinement (Tatarchuk 2006). The one shared world XZ offset moves every layer's
 * sampling, so blends and the micro detail stay registered. Only the strongest relief layer is
 * marched; its weight margin over the next relief layer fades the offset to zero where two relief
 * layers meet, so no seam appears at their border.
 *
 * Bands: the possession weight (uExplorationFog: 0 in the strategic view and under cinematics), the
 * projected size (world units per pixel across the view, so the spyglass extends it) and the view
 * elevation (grazing pixels fade out instead of stretching). The shift is limited (Welsh 2004), so
 * the far band never steps over whole stones.
 */
export const GROUND_PARALLAX_GLSL = `
#ifdef GROUND_PARALLAX
uniform vec3 cameraPosition;

/** Deepest hollow below a crest (world units, gravel). */
const float PARALLAX_DEPTH = 0.055;
/** Across-view footprint (world units per pixel) where the effect starts to fade and is gone. */
const float PARALLAX_NEAR_FULL = 0.008;
const float PARALLAX_NEAR_NONE = 0.018;
/** View elevation (eye vector y) below which the effect fades out (grazing angles). */
const float PARALLAX_GRAZING_NONE = 0.05;
const float PARALLAX_GRAZING_FULL = 0.16;
/**
 * Reference depth of the mesh surface inside the relief (0 crest .. 1 hollow): crests rise above
 * the triangles and hollows sink below, so the mean texture does not slide under props, roads and
 * the near-band edge as the eye moves.
 */
const float PARALLAX_REFERENCE = 0.5;
/** Offset limiting: the march never reaches farther than PARALLAX_DEPTH / PARALLAX_MIN_ELEVATION. */
const float PARALLAX_MIN_ELEVATION = 0.3;
/**
 * Steps follow the march length in tile texels (one step per PARALLAX_TEXELS_PER_STEP, rounded up to
 * whole batches of four, 4..8): a steep view marches a few texels, a low view up to ~30. The march
 * reads the height one mip coarser than the albedo (PARALLAX_MIP_SCALE on the gradients): smoother
 * and cache friendly.
 */
const float PARALLAX_MIN_STEPS = 4.0;
const float PARALLAX_MAX_STEPS = 8.0;
const float PARALLAX_TEXELS_PER_STEP = 2.0;
const float PARALLAX_MIP_SCALE = 2.0;
const float PARALLAX_TILE_TEXELS = ${MATERIAL_TILE_SIZE.toFixed(1)};

/** A relief layer's constants (folded at compile time): array layer, tile scale, depth share, turn. */
struct ParallaxLayer {
  float layer;
  float scale;
  float depth;
  float turn;
};

struct ParallaxPick {
  ParallaxLayer layer;
  float top;
  float second;
};

void considerParallaxLayer(inout ParallaxPick pick, float weight, ParallaxLayer layer) {
  if (weight <= pick.top) {
    pick.second = max(pick.second, weight);
    return;
  }
  pick.second = pick.top;
  pick.top = weight;
  pick.layer = layer;
}

ParallaxPick pickParallaxLayer(vec4 reliefWeights) {
  ParallaxPick pick = ParallaxPick(ParallaxLayer(0.0, 0.0, 0.0, 0.0), 0.0, 0.0);
${reliefLayerGlsl}
  return pick;
}

/**
 * The march in one untile frame's space (the frame that dominates this pixel; quarter turn and
 * offset applied once): entry uv, shift per full depth and the height gradients, all in tile uv.
 */
struct ParallaxRay {
  float layer;
  vec2 entry;
  vec2 shift;
  vec2 dx;
  vec2 dy;
};

ParallaxRay createParallaxRay(ParallaxLayer layer, vec2 entry, vec2 shift, vec2 dx, vec2 dy,
  UntileFrame untile) {
  bool second = untile.blend >= 0.5;
  vec2 offset = second ? untile.offsetB : untile.offsetA;
  float turns = (second ? untile.turnB : untile.turnA) * layer.turn;
  return ParallaxRay(layer.layer, turnQuarter(entry, turns) + offset, turnQuarter(shift, turns),
    turnQuarter(dx, turns), turnQuarter(dy, turns));
}

/** Depth below the crest (0 crest .. 1 deepest) at a share of the ray. */
float sampleParallaxDepth(ParallaxRay ray, float along) {
  return 1.0 - textureGrad(uGroundAlbedo, groundLayerUv(ray.layer, ray.entry + ray.shift * along), ray.dx,
    ray.dy).a;
}

/** Ray depth where the height field is crossed between two samples (linear refinement). */
float refineParallaxHit(float before, float previousGap, float gap, float stepSize) {
  return before + stepSize * previousGap / max(previousGap - gap, 1e-5);
}

/**
 * Share of the ray (0..1 of the march) where it first meets the height field. The heights are read
 * four at a time (rays 0..3, 4..7, ...): the fetches of a batch do not depend on each other, so a
 * march waits for at most PARALLAX_MAX_STEPS / 4 fetch round trips. The ray's end (share 1) lies at
 * the deepest hollow and always meets the field, so it needs no fetch.
 */
float marchParallax(ParallaxRay ray, float steps) {
  float stepSize = 1.0 / steps;
  float previousGap = 1.0;
  for (int batch = 0; batch < int(PARALLAX_MAX_STEPS) / 4; batch++) {
    float first = float(batch) * 4.0 * stepSize;
    if (first >= 1.0) break;
    vec4 rays = first + stepSize * vec4(0.0, 1.0, 2.0, 3.0);
    vec4 gaps = vec4(sampleParallaxDepth(ray, rays.x), sampleParallaxDepth(ray, rays.y),
      sampleParallaxDepth(ray, rays.z), sampleParallaxDepth(ray, rays.w)) - rays;
    if (gaps.x <= 0.0) return batch == 0 ? 0.0 : refineParallaxHit(first - stepSize, previousGap, gaps.x, stepSize);
    if (gaps.y <= 0.0) return refineParallaxHit(rays.x, gaps.x, gaps.y, stepSize);
    if (gaps.z <= 0.0) return refineParallaxHit(rays.y, gaps.y, gaps.z, stepSize);
    if (gaps.w <= 0.0) return refineParallaxHit(rays.z, gaps.z, gaps.w, stepSize);
    previousGap = gaps.w;
  }
  return 1.0;
}

/**
 * Pixel weight of the effect: possession, near band, layer weight and margin, view elevation and
 * the untile frame (only one frame is marched, so the offset fades out where both frames mix
 * evenly instead of jumping between their height fields).
 */
float getParallaxStrength(float near, ParallaxPick pick, float elevation, float untileBlend) {
  return near * smoothstep(0.25, 0.6, pick.top) * smoothstep(0.0, 0.15, pick.top - pick.second)
    * smoothstep(PARALLAX_GRAZING_NONE, PARALLAX_GRAZING_FULL, elevation)
    * smoothstep(0.0, 0.9, abs(untileBlend - 0.5) * 2.0);
}

/** World XZ offset of the visible relief point (zero outside the possessed near band). */
vec2 getGroundParallax(vec4 reliefWeights, vec3 world, vec2 uv, vec2 dx, vec2 dy, float across,
  UntileFrame untile) {
  float near = uExplorationFog * (1.0 - smoothstep(PARALLAX_NEAR_FULL, PARALLAX_NEAR_NONE, across));
  if (near <= 0.0) return vec2(0.0);
  ParallaxPick pick = pickParallaxLayer(reliefWeights);
  vec3 eye = normalize(cameraPosition - world);
  float strength = getParallaxStrength(near, pick, eye.y, untile.blend);
  if (strength <= 0.001) return vec2(0.0);
  vec2 worldShift = -eye.xz / max(eye.y, PARALLAX_MIN_ELEVATION) * PARALLAX_DEPTH * pick.layer.depth;
  float scale = pick.layer.scale;
  vec2 tileShift = worldShift * scale;
  float batches = ceil(length(tileShift) * PARALLAX_TILE_TEXELS / (PARALLAX_TEXELS_PER_STEP * 4.0));
  float steps = clamp(batches * 4.0, PARALLAX_MIN_STEPS, PARALLAX_MAX_STEPS);
  float marchScale = scale * PARALLAX_MIP_SCALE;
  ParallaxRay ray = createParallaxRay(pick.layer, (uv - worldShift * PARALLAX_REFERENCE) * scale, tileShift,
    dx * marchScale, dy * marchScale, untile);
  return worldShift * (marchParallax(ray, steps) - PARALLAX_REFERENCE) * strength;
}
#endif
`;
