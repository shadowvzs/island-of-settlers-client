import { Float32BufferAttribute, LatheGeometry, Vector2 } from "three";

import type { BuildingPart, DrinkVesselShape } from "../../../render-common/buildings/building-recipe";

type Profile = ReadonlyArray<readonly [number, number]>;
/** Shade factor of a lathe vertex: height fraction t (0 bottom .. 1 top), around fraction u. */
type Shade = (t: number, u: number) => number;

interface Vessel {
  profile: (detailed: boolean) => Profile;
  /** Lathe segments on High (Minimal halves them). */
  segments: number;
  shade?: Shade;
  /** Ridged cross-section: a husked coconut's three faces. */
  ridges?: number;
}

const curve = (count: number, at: (t: number) => readonly [number, number]) =>
  Array.from({ length: count + 1 }, (_, index) => at(index / count));

/** Bulged staves between chimes; the heads sit inside the stave ends. */
const barrelProfile = (detailed: boolean): Profile => detailed ? [
  [0, 0.03], [0.36, 0.03], [0.36, 0], [0.4, 0],
  ...curve(8, t => [0.4 + 0.1 * Math.sin(Math.PI * t), 0.02 + t * 0.96] as const),
  [0.4, 1], [0.36, 1], [0.36, 0.97], [0, 0.97]
] : [[0, 0], [0.4, 0], [0.5, 0.5], [0.4, 1], [0, 1]];

/** Round-bellied clay jar with a narrow neck and rolled lip (Nubian toddy jar). */
const jarProfile = (detailed: boolean): Profile => !detailed
  ? [[0, 0], [0.24, 0], [0.5, 0.4], [0.18, 0.86], [0.22, 1], [0, 0.96]] : [
  [0, 0], [0.22, 0],
  ...curve(5, t => [0.22 + 0.28 * Math.sin(Math.PI * (0.15 + t * 0.85)) ** 0.8, 0.02 + t * 0.76] as const),
  [0.18, 0.84], [0.16, 0.92], [0.22, 0.97], [0.21, 1], [0.13, 0.98], [0.12, 0.9]
];

/** Bottle gourd: a large lower bulb, waist and a small upper bulb with its stalk. */
const gourdProfile = (detailed: boolean): Profile => !detailed
  ? [[0, 0], [0.48, 0.25], [0.2, 0.62], [0.3, 0.78], [0, 1]] : [
  [0, 0],
  ...curve(6, t => [0.5 * Math.sin(Math.PI * (0.08 + t * 0.84)), t * 0.58] as const),
  [0.2, 0.64],
  ...curve(4, t => [0.2 + 0.12 * Math.sin(Math.PI * t), 0.66 + t * 0.26] as const),
  [0.07, 0.95], [0.04, 1], [0, 1]
];

/** Squat glazed honey pot: wide belly, short neck, flared lip. */
const honeyPotProfile = (detailed: boolean): Profile => !detailed
  ? [[0, 0], [0.34, 0], [0.5, 0.42], [0.32, 0.9], [0.38, 1], [0, 0.94]] : [
  [0, 0], [0.32, 0],
  ...curve(6, t => [0.32 + 0.18 * Math.sin(Math.PI * (0.1 + t * 0.8)), 0.04 + t * 0.72] as const),
  [0.34, 0.86], [0.32, 0.92], [0.38, 0.97], [0.37, 1], [0.3, 0.99], [0.28, 0.94]
];

/** Rice straw bale (tawara): a full cylinder with rounded, tucked ends. */
const baleProfile = (detailed: boolean): Profile => !detailed
  ? [[0, 0], [0.42, 0.03], [0.5, 0.14], [0.5, 0.86], [0.42, 0.97], [0, 1]] : [
  [0, 0], [0.3, 0.005], [0.42, 0.04], [0.48, 0.1],
  ...curve(6, t => [0.5 + 0.015 * Math.sin(Math.PI * t), 0.14 + t * 0.72] as const),
  [0.48, 0.9], [0.42, 0.96], [0.3, 0.995], [0, 1]
];

/** Coiled straw skep: a domed hive. */
const skepProfile = (detailed: boolean): Profile => curve(detailed ? 12 : 4, t => {
  const dome = Math.sqrt(Math.max(0, 1 - t ** 2.2));
  return [0.5 * dome, t] as const;
});

/** Coconut: an ovoid with a pointed end (High: the three ridges come from the shading). */
const coconutProfile = (detailed: boolean): Profile => curve(detailed ? 8 : 3, t => {
  const angle = t * Math.PI;
  return [Math.sin(angle) * 0.5 * (1 - 0.22 * t * t), (1 - Math.cos(angle)) / 2] as const;
});

/** Open half shell or bowl (outer wall, rim, inner wall). */
const bowlProfile = (detailed: boolean): Profile => [
  ...curve(detailed ? 6 : 2, t => [0.5 * Math.sin((Math.PI / 2) * t), 1 - Math.cos((Math.PI / 2) * t)] as const),
  [0.44, 0.96], [0.3, 0.6], [0, 0.5]
];

/** Straight-sided cocoa cup: preserve the outside cylinder, with a real open mouth and inner wall. */
const straightCupProfile = (): Profile => [
  [0, 0], [.5, 0], [.5, 1], [.42, 1], [.42, .08], [0, .08]
];

const staves: Shade = (_, u) => 0.84 + 0.16 * Math.abs(Math.sin(u * Math.PI * 14));
const coils: Shade = t => 0.82 + 0.18 * Math.abs(Math.sin(t * Math.PI * 9));
const straw: Shade = (t, u) => 0.86 + 0.14 * Math.abs(Math.sin(u * Math.PI * 40 + t * 3));
/** Husk fibres: fine streaks along the nut, darker towards the stalk end. */
const husk: Shade = (t, u) =>
  (0.62 + 0.38 * Math.abs(Math.sin(u * Math.PI * 22 + t * 4)) ** 0.6) * (0.82 + 0.18 * Math.sin(u * 97 + t * 13)) * (1 - 0.18 * t);

const VESSELS: Record<DrinkVesselShape, Vessel> = {
  "barrel": { profile: barrelProfile, segments: 24, shade: staves },
  "bowl": { profile: bowlProfile, segments: 16 },
  "straight-cup": { profile: straightCupProfile, segments: 20 },
  "clay-jar": { profile: jarProfile, segments: 14 },
  "coconut": { profile: coconutProfile, ridges: 3, segments: 12, shade: husk },
  "gourd": { profile: gourdProfile, segments: 14 },
  "honey-pot": { profile: honeyPotProfile, segments: 18 },
  "rice-bale": { profile: baleProfile, segments: 20, shade: straw },
  "skep": { profile: skepProfile, segments: 18, shade: coils }
};

export const isDrinkVesselShape = (shape: BuildingPart["shape"]): shape is DrinkVesselShape => shape in VESSELS;

/**
 * Unit vessel (radius 0.5, height 1, centred like the other part shapes) turned from its
 * profile; stave seams, straw and skep coils are baked into the vertex colours. `lean` (stock
 * piles, where six stand together) uses the Minimal turning.
 */
export const createDrinkVesselGeometry = (shape: DrinkVesselShape, detailed: boolean, lean = false) => {
  const vessel = VESSELS[shape], fine = detailed && !lean;
  const segments = fine ? vessel.segments : Math.max(6, Math.round(vessel.segments / 4));
  const geometry = new LatheGeometry(vessel.profile(fine).map(([radius, height]) =>
    new Vector2(radius, height - 0.5)), segments);
  const positions = geometry.getAttribute("position"), uvs = geometry.getAttribute("uv");
  const colors = new Float32Array(positions.count * 3);
  for (let vertex = 0; vertex < positions.count; vertex += 1) {
    const factor = vessel.shade ? vessel.shade(positions.getY(vertex) + 0.5, uvs.getX(vertex)) : 1;
    colors.set([factor, factor, factor], vertex * 3);
  }
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  if (vessel.ridges) ridge(geometry, vessel.ridges);
  return geometry;
};

/** Pushes the lathe out along `count` ridges round its axis (normals recomputed). */
const ridge = (geometry: LatheGeometry, count: number) => {
  const positions = geometry.getAttribute("position");
  for (let vertex = 0; vertex < positions.count; vertex += 1) {
    const x = positions.getX(vertex), z = positions.getZ(vertex);
    const factor = 1 + 0.08 * Math.cos(count * Math.atan2(z, x));
    positions.setXYZ(vertex, x * factor, positions.getY(vertex), z * factor);
  }
  geometry.computeVertexNormals();
};
