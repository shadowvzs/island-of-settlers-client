import {
  AdditiveBlending, type Box3, Group, InstancedMesh, NoColorSpace, Object3D, type Texture, type Vector3
} from "three";

import {
  fortCollapseScale, fortFlameFade, fortRuinOpacity, isFortSmouldering
} from "../../../render-common/buildings/fort-siege-visual";
import { FORT_FLAME_MILESTONES } from "../../../shared/settlement/fort-assault-rules";
import { type BurnResources,coverBurnBounds } from "./building-burn-effects";
import {
  BILLBOARD_VERTEX, burnMaterial, burnRandom, EMBER_FRAGMENT, EMBER_VERTEX, FLAME_VERTEX, flameFragment,
  layOutCharredRuin, setBurnUniforms, smokeMaterial
} from "./building-burn-shaders";
import { sampleBuildingFireAnchors } from "./building-fire-anchors";
import { createFlameTexture } from "./roman-furnace-fire";

/** Flame tongues per milestone fire (High: volumetric boxes; Minimal: billboards) and smoke puffs. */
const TONGUES = { high: 3, minimal: 2 } as const;
const PUFFS = { high: 4, minimal: 3 } as const;
const EMBERS = { high: 24, minimal: 6 } as const;
/** Seconds a new fire takes to flare up to full size. */
const IGNITION_SECONDS = 1.2;
/** Volumetric flames fill only the middle of their box: High boxes are drawn larger to match. */
const VOLUME_SCALE = 1.4;
/** A fallen fort burns fiercer until it collapses. */
const FALLEN_INTENSITY = 1.35;
/** Candidate surface points sampled before the five fire spots are spread among them. */
const ANCHOR_CANDIDATES = 30;

/** Minimal: the furnace flame texture on a camera-facing quad, swaying and licking upwards. */
const BILLBOARD_FLAME_FRAGMENT = `precision highp float;
uniform float age;
uniform float fade;
uniform sampler2D flameMap;
in vec3 local;
in vec3 vWorld;
in float seed;
out vec4 fragColor;
void main() {
  vec2 uv = local.xy + 0.5;
  float lick = 0.88 + 0.12 * sin(age * 9.0 + seed * 2.0);
  vec2 sampleAt = vec2(uv.x + sin(uv.y * 7.0 + age * 6.0 + seed) * 0.05 * uv.y, uv.y / lick);
  if (sampleAt.y > 1.0) discard;
  vec4 flame = texture(flameMap, sampleAt);
  float alpha = flame.a * fade;
  if (alpha < 0.02) discard;
  fragColor = vec4(flame.rgb, alpha);
}`;
/** High: an additive glow at each fire, flickering like firelight on the walls. */
const GLOW_FRAGMENT = `precision highp float;
uniform float age;
uniform float fade;
in vec3 local;
in vec3 vWorld;
in float seed;
out vec4 fragColor;
void main() {
  float falloff = pow(max(0.0, 1.0 - length(local.xy) * 2.0), 2.0);
  float flicker = 0.72 + 0.16 * sin(age * 13.0 + seed * 3.1) + 0.12 * sin(age * 23.0 + seed * 7.0);
  fragColor = vec4(1.0, 0.5, 0.15, falloff * flicker * fade * 0.85);
}`;

/** Up to `count` spots spread over the roof and walls: the highest first, then each farthest from the rest. */
export const spreadFireSpots = (candidates: readonly Vector3[], count: number) => {
  if (!candidates.length) return [];
  const spots = [candidates.reduce((top, point) => point.y > top.y ? point : top)];
  while (spots.length < Math.min(count, candidates.length)) {
    let best = candidates[0]!, bestDistance = -1;
    for (const point of candidates) {
      const nearest = Math.min(...spots.map(spot => spot.distanceTo(point)));
      if (nearest > bestDistance) { best = point; bestDistance = nearest; }
    }
    spots.push(best);
  }
  return spots;
};

export interface FortSiegeState { flames: number; fallenAge?: number }

/**
 * Fires on a colony fort under assault (owner decision 2026-10-13): every 20 % of wall hit points
 * lost lights a new fire at another spot on its roof and walls, with rising smoke; the fallen fort
 * burns on, collapses and leaves black charred timber that smoulders (High) until it is cleared.
 * Reuses the demolition burn-down's volumetric flames, smoke, embers and charred timber; Minimal
 * draws the furnace flame texture on billboards.
 */
export const createFortSiegeFires = (high: boolean, resources: BurnResources) => {
  const transform = new Object3D();
  const detail = high ? "high" : "minimal";
  let flameMap: Texture | undefined;
  const minimalFlameMap = () => {
    if (flameMap) return flameMap;
    flameMap = createFlameTexture(true, 7);
    flameMap.colorSpace = NoColorSpace;
    return flameMap;
  };
  const flameMesh = (count: number) => high
    ? new InstancedMesh(resources.fireGeometry, burnMaterial(FLAME_VERTEX, flameFragment(16), {}, resources.atmosphereUniforms), count)
    : new InstancedMesh(resources.smokeGeometry,
      burnMaterial(BILLBOARD_VERTEX, BILLBOARD_FLAME_FRAGMENT,
        { flameMap: { value: minimalFlameMap() } }, resources.atmosphereUniforms), count);
  const create = (bounds: Box3, identity: string, structure: Object3D) => {
    const root = new Group(); root.name = `siege-fire-${identity}`;
    root.position.set((bounds.min.x + bounds.max.x) / 2, bounds.min.y, (bounds.min.z + bounds.max.z) / 2);
    const width = bounds.max.x - bounds.min.x, depth = bounds.max.z - bounds.min.z;
    const height = Math.max(1, bounds.max.y - bounds.min.y);
    const spots = spreadFireSpots(sampleBuildingFireAnchors(structure, bounds, ANCHOR_CANDIDATES),
      FORT_FLAME_MILESTONES);
    const fire = flameMesh(FORT_FLAME_MILESTONES * TONGUES[detail]);
    const smoke = new InstancedMesh(resources.smokeGeometry, smokeMaterial(.34, .6, resources.atmosphereUniforms), FORT_FLAME_MILESTONES * PUFFS[detail]);
    const embers = new InstancedMesh(resources.emberGeometry, burnMaterial(EMBER_VERTEX, EMBER_FRAGMENT, {}, resources.atmosphereUniforms), EMBERS[detail]);
    const ruinMaterial = resources.timber.clone();
    const ruins = new InstancedMesh(resources.beamGeometry, ruinMaterial, high ? 40 : 20);
    const meshes = [fire, smoke, embers, ruins];
    const glowMaterial = high ? burnMaterial(BILLBOARD_VERTEX, GLOW_FRAGMENT, {}, resources.atmosphereUniforms, true) : undefined;
    if (glowMaterial) glowMaterial.blending = AdditiveBlending;
    const glow = glowMaterial && new InstancedMesh(resources.smokeGeometry, glowMaterial, FORT_FLAME_MILESTONES);
    if (glow) meshes.push(glow);
    coverBurnBounds(meshes, width, depth, height);
    root.add(...meshes);
    layOutCharredRuin(ruins, width, depth, true);
    const random = burnRandom(width, depth);
    /** Render time each fire was lit (NaN: not yet). */
    const litAt = new Array<number>(FORT_FLAME_MILESTONES).fill(NaN);
    const growthOf = (spot: number, time: number) => Number.isNaN(litAt[spot]!) ? 0
      : Math.min(1, (time - litAt[spot]!) / IGNITION_SECONDS);
    const placeFlames = (fires: number, time: number, collapse: number, intensity: number) => {
      const tongues = TONGUES[detail], volume = high ? VOLUME_SCALE : 1;
      for (let spot = 0; spot < fires; spot++) for (let tongue = 0; tongue < tongues; tongue++) {
        const anchor = spots[spot]!, index = spot * tongues + tongue, growth = growthOf(spot, time);
        const pulse = .86 + Math.sin(time * 4.3 + index * 1.7) * .16 + Math.sin(time * 9.1 + index * .9) * .08;
        const size = (.8 + random(index + 7) * .5) * growth * intensity * volume;
        const tall = (1.3 + height * .28) * pulse * growth * intensity * volume;
        const x = anchor.x + (random(index * 5) - .5) * .5, z = anchor.z + (random(index * 5 + 1) - .5) * .5;
        const y = Math.max(.06, anchor.y * collapse - .035);
        transform.rotation.set(0, random(index) * 6.28, 0);
        // Volumetric boxes grow up from their base; billboards are centred, so they stand half up.
        transform.position.set(x, high ? y : y + tall / 2, z);
        transform.scale.set(size, tall, size);
        transform.updateMatrix(); fire.setMatrixAt(index, transform.matrix);
      }
      fire.count = fires * tongues;
      fire.instanceMatrix.needsUpdate = true;
    };
    const placeSmoke = (fires: number, time: number, collapse: number, thin: boolean) => {
      const puffs = PUFFS[detail];
      for (let spot = 0; spot < fires; spot++) for (let puff = 0; puff < puffs; puff++) {
        const anchor = spots[spot]!, index = spot * puffs + puff;
        const rise = (time * .22 + random(index + 11)) % 1;
        transform.position.set(anchor.x + rise * .8, anchor.y * collapse + 1.2 + rise * (height + 2.5),
          anchor.z + (random(index + 3) - .5) * .4);
        transform.rotation.set(0, 0, 0);
        transform.scale.setScalar((.2 + rise * 2.2) * growthOf(spot, time) * (thin ? .6 : 1));
        transform.updateMatrix(); smoke.setMatrixAt(index, transform.matrix);
      }
      smoke.count = fires * puffs;
      smoke.instanceMatrix.needsUpdate = true;
    };
    const placeEmbers = (time: number, collapse: number) => {
      for (let index = 0; index < embers.count; index++) {
        const anchor = spots[index % spots.length]!, rise = (time * .32 + random(index + 31)) % 1;
        const drift = Math.sin(time * 1.1 + index) * rise * .5;
        transform.position.set(anchor.x + drift, anchor.y * collapse + rise * (height + 2), anchor.z + drift * .6);
        transform.rotation.set(0, 0, 0);
        transform.scale.setScalar((.018 + random(index + 19) * .035) * (1 - rise));
        transform.updateMatrix(); embers.setMatrixAt(index, transform.matrix);
      }
      embers.instanceMatrix.needsUpdate = true;
    };
    const placeGlow = (fires: number, time: number, collapse: number) => {
      if (!glow) return;
      for (let spot = 0; spot < fires; spot++) {
        const anchor = spots[spot]!;
        transform.position.set(anchor.x, anchor.y * collapse + .5, anchor.z);
        transform.rotation.set(0, 0, 0);
        transform.scale.setScalar((2.2 + height * .3) * growthOf(spot, time));
        transform.updateMatrix(); glow.setMatrixAt(spot, transform.matrix);
      }
      glow.count = fires;
      glow.instanceMatrix.needsUpdate = true;
    };
    const update = (state: FortSiegeState, time: number) => {
      const fallen = state.fallenAge !== undefined;
      const fires = Math.min(spots.length, fallen ? FORT_FLAME_MILESTONES : state.flames);
      for (let spot = 0; spot < fires; spot++) if (Number.isNaN(litAt[spot]!)) litAt[spot] = time;
      const collapse = fortCollapseScale(state.fallenAge), flameFade = fortFlameFade(state.fallenAge);
      const smouldering = isFortSmouldering(state.fallenAge);
      const animation = time % 1000;
      setBurnUniforms(fire.material, animation, flameFade);
      setBurnUniforms(smoke.material, animation, smouldering ? .55 : 1);
      setBurnUniforms(embers.material, animation, 1);
      fire.visible = flameFade > 0;
      if (fire.visible) placeFlames(fires, time, collapse, fallen ? FALLEN_INTENSITY : 1);
      smoke.visible = fires > 0 && (high || !smouldering);
      if (smoke.visible) placeSmoke(fires, time, collapse, smouldering);
      embers.visible = fallen && (high || !smouldering);
      if (embers.visible) placeEmbers(time, collapse);
      ruinMaterial.opacity = fortRuinOpacity(state.fallenAge);
      ruins.visible = ruinMaterial.opacity > 0;
      if (glow && glowMaterial) {
        setBurnUniforms(glowMaterial, animation, flameFade);
        glow.visible = fire.visible && fires > 0;
        if (glow.visible) placeGlow(fires, time, collapse);
      }
    };
    return { root, update, dispose: () => {
      root.removeFromParent();
      for (const mesh of meshes) mesh.dispose();
      fire.material.dispose(); smoke.material.dispose(); embers.material.dispose(); ruinMaterial.dispose();
      glowMaterial?.dispose();
    } };
  };
  return { create, dispose: () => { flameMap?.dispose(); } };
};
