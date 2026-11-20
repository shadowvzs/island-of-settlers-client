import {
  type BufferGeometry, CircleGeometry, Float32BufferAttribute, LatheGeometry, MeshStandardMaterial, Vector2
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import { lerp3, scale3 } from "../../shared/world/noise";
import { dataTexture, hash, RUNES, segmentDistance } from "./buildings/viking-statue-textures";

/**
 * The one Viking round shield (owner reference 2026-10-13), shared by the longship's rail row and
 * the wall trophies: dark-stained vertical planks with grain, gaps and a few nail heads, a riveted
 * grey iron rim and a polished domed boss on a riveted, rune-engraved flange. Unpainted.
 * Unit model: radius 0.5, facing +Z, back at z -0.03, boss crown at z 0.15.
 */
const RADII = { boss: .122, flange: .172, rim: .465 } as const;
/** Plank joints across the face (x), slightly irregular as on a hand-made board. */
const PLANK_EDGES = [-.5, -.356, -.214, -.072, .07, .208, .352, .5] as const;
const NAILS = [[-.41, -.03], [-.2, -.03], [.186, -.03], [.41, -.03]] as const;
const RIM_RIVETS = 16, FLANGE_CELLS = 10;

type Rgb = readonly [number, number, number];
/** Albedo (sRGB 0…1), relief height, roughness and metalness of one texel. */
interface Texel { color: Rgb; height: number; metal: number; rough: number }


const STAIN = {
  dark: [.15, .095, .062], gap: [.05, .033, .022], light: [.25, .155, .097], streak: [.46, .27, .14]
} as const;
const IRON = { boss: [.8, .81, .82], flange: [.66, .67, .69], rim: [.47, .48, .5], rivet: [.78, .79, .8] } as const;

/** A domed rivet or nail head: 0 outside, rising to 1 at its centre. */
const dome = (x: number, y: number, cx: number, cy: number, radius: number) => {
  const distance = Math.hypot(x - cx, y - cy) / radius;
  return distance >= 1 ? 0 : Math.sqrt(1 - distance * distance);
};

const ironTexel = (color: Rgb, rivet: number, metal: number, rough: number, height: number): Texel => ({
  color: rivet > 0 ? scale3(IRON.rivet, .7 + rivet * .3) : color, height: height + rivet * .3, metal,
  rough: rivet > 0 ? .35 : rough
});

/** Hammered iron: low-frequency light and dark patches. */
const hammered = (color: Rgb, x: number, y: number) =>
  scale3(color, .9 + Math.sin(x * 41 + Math.sin(y * 23) * 2) * Math.sin(y * 37 + x * 9) * .1 +
    (hash(Math.floor(x * 300), Math.floor(y * 300)) - .5) * .06);

const rimTexel = (x: number, y: number, radius: number): Texel => {
  let rivet = 0;
  for (let index = 0; index < RIM_RIVETS && rivet === 0; index++) {
    const angle = (index + .5) / RIM_RIVETS * Math.PI * 2;
    rivet = dome(x, y, Math.cos(angle) * .4825, Math.sin(angle) * .4825, .0085);
  }
  const inner = radius < RADII.rim + .005 ? .55 : 1;
  return ironTexel(scale3(hammered(IRON.rim, x, y), inner), rivet, .55, .5, .7 * inner);
};

/** The flange: a rivet at the start of each cell and an engraved rune in the rest of it. */
const flangeTexel = (x: number, y: number, radius: number): Texel => {
  const turn = (Math.atan2(y, x) / (Math.PI * 2) + 1) % 1, cell = Math.floor(turn * FLANGE_CELLS);
  const rivetAngle = cell / FLANGE_CELLS * Math.PI * 2, next = (cell + 1) / FLANGE_CELLS * Math.PI * 2;
  const rivetAt = (angle: number) => dome(x, y, Math.cos(angle) * .147, Math.sin(angle) * .147, .0065);
  const rivet = Math.max(rivetAt(rivetAngle), rivetAt(next));
  const s = (turn * FLANGE_CELLS - cell - .2) / .7;
  const t = (radius - RADII.boss - .008) / (RADII.flange - RADII.boss - .016);
  const glyph = RUNES[(cell * 5 + 3) % RUNES.length]!;
  const engraved = s > 0 && s < 1 && t > 0 && t < 1 &&
    Math.min(...glyph.map(stroke => segmentDistance(s, t, stroke))) < .085;
  const color = scale3(hammered(IRON.flange, x, y), engraved ? .45 : 1);
  return ironTexel(color, rivet, .6, .4, engraved ? .45 : .75);
};

const bossTexel = (x: number, y: number, radius: number): Texel => {
  const swirl = Math.sin(x * 60 + Math.sin(y * 40) * 1.5) * .04, foot = radius > RADII.boss - .006 ? .6 : 1;
  return { color: scale3(IRON.boss, (.96 + swirl) * foot), height: 1, metal: .65, rough: .22 };
};

const plankIndex = (x: number) => Math.max(0, PLANK_EDGES.findIndex(edge => x < edge) - 1);

/** Dark-stained plank: wavy grain, a lighter worn streak here and there, rounded edges and open joints. */
const woodTexel = (x: number, y: number): Texel => {
  const plank = plankIndex(x), seed = plank * 17.3;
  const edge = Math.min(x - PLANK_EDGES[plank]!, PLANK_EDGES[plank + 1]! - x);
  if (edge < .0045) return { color: STAIN.gap, height: 0, metal: 0, rough: .95 };
  const knotX = PLANK_EDGES[plank]! + .03 + hash(plank, 3) * .08, knotY = hash(plank, 9) * .7 - .35;
  const knot = Math.max(0, 1 - Math.hypot((x - knotX) * 2, (y - knotY) * .7) / .06);
  const wave = x * 95 + Math.sin(y * 4.3 + seed) * 2.4 + Math.sin(y * 17 + seed * 2) * .45 + knot * 9;
  const grain = .5 + .5 * Math.sin(wave);
  const streak = Math.max(0, Math.sin(x * 33 + seed + Math.sin(y * 2.1 + seed)) - .7) / .3;
  const tone = hash(plank, 1) * .35, rounded = Math.min(1, edge / .014);
  const wood = lerp3(lerp3(STAIN.dark, STAIN.light, grain * .5 + tone), STAIN.streak, streak * .55);
  const nail = Math.max(...NAILS.map(([nx, ny]) => dome(x, y, nx, ny, .0095)));
  if (nail > 0) return { color: scale3(IRON.rim, .55 + nail * .4), height: .6 + nail * .3, metal: .55, rough: .45 };
  return { color: scale3(wood, .7 + .3 * rounded), height: .45 + grain * .12 - (1 - rounded) * .2, metal: 0,
    rough: .82 };
};

const shieldTexel = (x: number, y: number): Texel => {
  const radius = Math.hypot(x, y);
  if (radius >= RADII.rim) return rimTexel(x, y, radius);
  if (radius >= RADII.flange) return woodTexel(x, y);
  if (radius >= RADII.boss) return flangeTexel(x, y, radius);
  return bossTexel(x, y, radius);
};

/** Albedo, height and (High) roughness/metalness maps of the shield face, painted once per detail level. */
const paintShieldMaps = (size: number) => {
  const albedo = new Uint8Array(size * size * 4), height = new Uint8Array(size * size * 4);
  const surface = new Uint8Array(size * size * 4);
  for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) {
    const texel = shieldTexel((column + .5) / size - .5, (row + .5) / size - .5), index = (row * size + column) * 4;
    albedo.set([...texel.color.map(value => Math.min(255, value * 255)), 255], index);
    height.set([texel.height * 255, texel.height * 255, texel.height * 255, 255], index);
    surface.set([255, texel.rough * 255, texel.metal * 255, 255], index);
  }
  return { albedo: dataTexture(albedo, size, true), height: dataTexture(height, size, false),
    surface: dataTexture(surface, size, false) };
};

const shieldMaps = new Map<boolean, ReturnType<typeof paintShieldMaps>>();
const shieldMapsFor = (detailed: boolean) => {
  let maps = shieldMaps.get(detailed);
  if (!maps) { maps = paintShieldMaps(detailed ? 512 : 128); shieldMaps.set(detailed, maps); }
  return maps;
};

/**
 * Dresses `material` as the shield (stained wood and iron in one texture). High adds the relief and
 * the roughness/metalness map; Minimal keeps one matt finish. The maps are shared and stay cached.
 */
export const dressVikingShieldMaterial = (material: MeshStandardMaterial, detailed: boolean) => {
  const maps = shieldMapsFor(detailed);
  material.color.setRGB(1, 1, 1);
  material.map = maps.albedo;
  material.normalMap = null;
  material.bumpMap = detailed ? maps.height : null; material.bumpScale = 1.4;
  material.roughnessMap = detailed ? maps.surface : null; material.metalnessMap = detailed ? maps.surface : null;
  material.roughness = detailed ? 1 : .55; material.metalness = detailed ? 1 : .45;
  material.needsUpdate = true;
  return material;
};

export const createVikingShieldMaterial = (detailed: boolean) =>
  dressVikingShieldMaterial(new MeshStandardMaterial(), detailed);

type Profile = readonly (readonly [number, number])[];

/** Rim and boss profiles (radius, z), each wound so the lathe faces outwards. */
const PROFILES: Readonly<Record<"high" | "minimal", { boss: Profile; rim: Profile; segments: number }>> = {
  high: {
    boss: [[.172, .0105], [.128, .022], [.121, .04], [.105, .1], [.06, .138], [0, .15]],
    rim: [[.46, -.03], [.49, -.03], [.505, -.006], [.5, .02], [.463, .013]], segments: 16
  },
  minimal: {
    boss: [[.172, .011], [.1, .105], [0, .15]],
    rim: [[.5, -.03], [.5, .02], [.463, .013]], segments: 9
  }
};

/** Front-view UVs: the texture is the shield seen face on. */
const planarUv = (geometry: BufferGeometry, scale = 1, centre: readonly [number, number] = [.5, .5]) => {
  const position = geometry.getAttribute("position"), uv: number[] = [];
  for (let index = 0; index < position.count; index++)
    uv.push(centre[0] + position.getX(index) * scale, centre[1] + position.getY(index) * scale);
  geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  return geometry;
};

const lathe = (profile: Profile, segments: number) =>
  planarUv(new LatheGeometry(profile.map(([radius, z]) => new Vector2(radius, z)), segments).rotateX(Math.PI / 2));

/**
 * The shield model (one geometry): planked face, rolled iron rim, flanged dome boss and a plain
 * planked back (its UVs sample a board area clear of the boss).
 */
export const createVikingRoundShieldGeometry = (detailed: boolean) => {
  const { boss, rim, segments } = PROFILES[detailed ? "high" : "minimal"];
  const face = planarUv(new CircleGeometry(.47, segments).translate(0, 0, .011));
  const back = planarUv(new CircleGeometry(rim[0]![0], segments).rotateY(Math.PI).translate(0, 0, -.03), .25,
    [.2, .5]);
  const pieces = [face, lathe(rim, segments), lathe(boss, detailed ? 12 : 6), back]
    .map(piece => { const flat = piece.toNonIndexed(); piece.dispose(); return flat; });
  const shield = mergeGeometries(pieces, false)!;
  pieces.forEach(piece => piece.dispose());
  return shield;
};
