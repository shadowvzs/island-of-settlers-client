import { BoxGeometry, ConeGeometry, CylinderGeometry, ExtrudeGeometry, SphereGeometry } from "three";

import type { WorkerNation } from "../../render-common/workers/worker-unit";
import { createFinishes, type Finishes } from "./military-equipment-finishes";
import { BLADE_SECTIONS, type BladeStation, lathe, loftBlade } from "./military-equipment-geometry";
import { createEquipmentParts, type Finish } from "./military-equipment-mesh";
import { khopeshBladeShape } from "./military-equipment-parts";

/**
 * Swords. Convention of every held weapon: the grip hand at the
 * origin, the blade along +Y, the cutting edge towards +X and the flat in the XY plane. A
 * two-handed sword's grip reaches past the lower hand, 0.15 below the origin.
 */
export type BladeKind = "infantry" | "cavalry" | "twoHanded";
/** Lowest point of a two-handed grip (below the second hand at -0.15). */
const TWO_HANDED_GRIP = -.215;
type Parts = ReturnType<typeof createEquipmentParts>;
interface Forge { detailed: boolean; finishes: Finishes; parts: Parts }

/** Blade stations from [y, halfWidth, x] triples with a constant thickness, tip thinner. */
const stations = (points: readonly (readonly [number, number, number?])[], thickness: number): BladeStation[] =>
  points.map(([y, halfWidth, x = 0], index) => ({
    halfThickness: index === points.length - 1 ? thickness * .3 : thickness, halfWidth, x, y
  }));

/** Every other station is dropped on Minimal (the first and the tip are kept). */
const lod = <T>(detailed: boolean, points: readonly T[]) =>
  detailed ? points : points.filter((_, index) => index === 0 || index === points.length - 1 || index % 2 === 0);

const grip = (forge: Forge, profile: readonly (readonly [number, number])[], finish: Finish) => {
  const points = forge.detailed ? profile : [profile[0]!, profile[Math.floor(profile.length / 2)]!, profile.at(-1)!];
  forge.parts.add(lathe(points, forge.detailed ? 8 : 5), finish);
};

/** Ribbed bone grip from just under the guard down to `bottom`: a finger ridge every 0.032. */
const ribbedGrip = (bottom: number) => {
  const profile: [number, number][] = [[0, bottom], [.016, bottom]];
  for (let y = bottom + .02, ridge = true; y < .008; y += .02, ridge = !ridge)
    profile.push([ridge ? .019 : .015, y]);
  profile.push([.019, .012], [0, .016]);
  return profile;
};

/** Roman gladius and spatha share the ribbed bone grip and the round pommel. */
const romanHilt = (forge: Forge, size: number, bottom = -.068) => {
  const { detailed, finishes, parts } = forge;
  parts.add(new CylinderGeometry(.038 * size, .042 * size, .026, detailed ? 12 : 5), finishes.wood,
    { position: [0, .028, 0], scale: [1, 1, .55] });
  if (detailed) parts.add(new CylinderGeometry(.04 * size, .04 * size, .006, 12), finishes.bronze,
    { position: [0, .043, 0], scale: [1, 1, .6] });
  grip(forge, ribbedGrip(bottom), finishes.bone);
  parts.add(new SphereGeometry(.03 * size, detailed ? 8 : 4, detailed ? 5 : 2), finishes.wood,
    { position: [0, bottom - .02, 0], scale: [1, .72, .8] });
  if (detailed) parts.add(new ConeGeometry(.008, .012, 6), finishes.bronze, { position: [0, bottom - .044, 0],
    rotation: [Math.PI, 0, 0] });
};

const romanBlade = (forge: Forge, kind: BladeKind) => {
  const section = forge.detailed ? BLADE_SECTIONS.diamond : BLADE_SECTIONS.wedge;
  const profiles: Record<BladeKind, readonly (readonly [number, number])[]> = {
    /** Pompeii gladius: broad parallel edges and a short triangular point. */
    infantry: [[.045, .028], [.16, .026], [.27, .026], [.33, .016], [.37, 0]],
    /** Cavalry spatha: longer, narrower, rounded point. */
    cavalry: [[.045, .024], [.25, .022], [.44, .021], [.5, .013], [.53, 0]],
    /** Heavy troops' long spatha, gripped in both hands. */
    twoHanded: [[.045, .026], [.3, .024], [.56, .022], [.63, .014], [.67, 0]]
  };
  forge.parts.add(loftBlade(stations(lod(forge.detailed, profiles[kind]), .006), section), forge.finishes.steel);
  romanHilt(forge, 1, kind === "twoHanded" ? TWO_HANDED_GRIP : -.068);
};

/** Viking sword: fullered blade, straight iron cross, dyed leather grip and a lobed pommel. */
const vikingSword = (forge: Forge, kind: BladeKind) => {
  const { detailed, finishes, parts } = forge;
  const length = kind === "infantry" ? .44 : .5;
  const section = detailed ? BLADE_SECTIONS.fullered : BLADE_SECTIONS.diamond;
  parts.add(loftBlade(stations(lod(detailed, [[.04, .025], [length * .45, .024], [length * .8, .021],
    [length * .95, .014], [length + .02, 0]]), .0055), section), finishes.steel);
  parts.add(new BoxGeometry(.115, .016, .026), finishes.iron, { position: [0, .032, 0] });
  grip(forge, [[0, -.07], [.016, -.07], [.018, -.03], [.017, .01], [.016, .025], [0, .025]], finishes.dyed);
  parts.add(new BoxGeometry(.07, .013, .024), finishes.iron, { position: [0, -.076, 0] });
  parts.add(lathe(detailed ? [[.034, 0], [.03, .012], [.018, .022], [0, .026]] : [[.034, 0], [0, .026]],
    detailed ? 10 : 4), finishes.iron, { position: [0, -.082, 0], rotation: [Math.PI, 0, 0], scale: [1, 1, .45] });
};

/** Bronze khopesh from the army icon outline, cutting with its outer hook. */
const khopesh = (forge: Forge, kind: BladeKind) => {
  const { detailed, finishes, parts } = forge;
  const size = { cavalry: .78, infantry: .68, twoHanded: .85 }[kind];
  const blade = new ExtrudeGeometry(khopeshBladeShape(), { bevelEnabled: detailed, bevelSegments: 1,
    bevelSize: .004, bevelThickness: .003, curveSegments: detailed ? 8 : 3, depth: .01 / size });
  parts.add(blade, [finishes.bronze, finishes.gold], { position: [0, .035, -.005], scale: [size, size, size] });
  if (detailed) parts.add(new CylinderGeometry(.022, .022, .014, 10), finishes.gold, { position: [0, .03, 0] });
  grip(forge, [[0, -.07], [.016, -.07], [.018, -.035], [.017, .025], [0, .025]], finishes.darkWood);
  parts.add(new SphereGeometry(.025, detailed ? 10 : 4, detailed ? 6 : 2), finishes.gold,
    { position: [0, -.082, 0], scale: [1, .75, 1] });
};

/** Katana / tachi: curved single edge, gold habaki, round tsuba, dyed ito-wrapped hilt. */
const japaneseBlade = (forge: Forge, kind: BladeKind) => {
  const { detailed, finishes, parts } = forge;
  const { curve, length, tsuba } = {
    cavalry: { curve: .05, length: .52, tsuba: .034 },
    infantry: { curve: .036, length: .46, tsuba: .032 },
    twoHanded: { curve: .045, length: .6, tsuba: .036 }
  }[kind];
  // Stations along the curved blade (sori towards -X); the kissaki closes slightly forward.
  const station = (t: number) => [.045 + t * length, .016 - .004 * t, -curve * t * t] as const;
  const tip = [.045 + length, 0, .008 - curve] as const;
  const points = [...[0, .25, .5, .75, .92].map(station), tip];
  const section = detailed ? BLADE_SECTIONS.singleEdge : BLADE_SECTIONS.wedge;
  parts.add(loftBlade(stations(lod(detailed, points), .005), section), finishes.steel);
  parts.add(new BoxGeometry(.03, .022, .014), finishes.gold, { position: [0, .045, 0] });
  parts.add(new CylinderGeometry(tsuba, tsuba, .008, detailed ? 12 : 5), finishes.iron,
    { position: [0, .03, 0], scale: [1, 1, .8] });
  const hilt = { cavalry: .17, infantry: .17, twoHanded: .026 - TWO_HANDED_GRIP }[kind];
  parts.add(new CylinderGeometry(.014, .015, hilt, detailed ? 8 : 5, 1, !detailed), finishes.dyed,
    { position: [0, .026 - hilt / 2, 0], scale: [1, 1, .8] });
  if (!detailed) return;
  parts.add(new CylinderGeometry(.016, .016, .012, 8), finishes.iron,
    { position: [0, .02 - hilt, 0], scale: [1, 1, .8] });
  for (let wrap = 0; wrap < Math.round(hilt / .03); wrap++)
    parts.add(new BoxGeometry(.012, .012, .03), finishes.bone, { position: [0, .002 - wrap * .03, 0],
      rotation: [0, 0, Math.PI / 4], scale: [.6, 1, 1] });
};

const FORGES: Record<WorkerNation, (forge: Forge, kind: BladeKind) => void> = {
  maya: romanBlade,
  persian: romanBlade,
  chinese: romanBlade,
  indigenous: romanBlade,
  japanese: japaneseBlade,
  nubian: khopesh,
  roman: romanBlade,
  viking: vikingSword
};

/** One nation's sword (infantry, mounted, two-handed) as a single baked geometry. */
export const buildBlade = (nation: WorkerNation, kind: BladeKind, detailed: boolean) => {
  const parts = createEquipmentParts();
  FORGES[nation]({ detailed, finishes: createFinishes(detailed), parts }, kind);
  return parts.build();
};
