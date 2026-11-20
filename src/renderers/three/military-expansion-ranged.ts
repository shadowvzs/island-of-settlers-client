import {
  BoxGeometry, CatmullRomCurve3, ConeGeometry, CylinderGeometry, SphereGeometry, TorusGeometry, TubeGeometry, Vector3
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

import type { WorkerNation } from "../../render-common/workers/worker-nation";
import { buildArrow, STRING_Z } from "./military-equipment-bows";
import { createFinishes } from "./military-equipment-finishes";
import { createEquipmentParts, type Finish } from "./military-equipment-mesh";

/** Crossbow coordinates: forward +Z, forehand contact at origin, trigger hand .18 behind it. */
export const CROSSBOW = { halfSpan: .255, limbZ: .15, stringDraw: -.115, triggerZ: -.18 } as const;

const tube = (points: readonly (readonly [number, number, number])[], detailed: boolean, radius: number) =>
  new TubeGeometry(new CatmullRomCurve3(points.map(point => new Vector3(...point))),
    detailed ? 24 : 8, radius, detailed ? 6 : 4, false);

export const buildChineseCrossbow = (detailed: boolean) => {
  const parts = createEquipmentParts(), f = createFinishes(detailed);
  const timber: Finish = { color: "#693c29", grain: detailed, rough: .63 };
  const horn: Finish = { color: "#39342c", rough: .48 };
  parts.add(new RoundedBoxGeometry(.048, .046, .49, detailed ? 2 : 1, .007), timber,
    { position: [0, .025, -.075] });
  // Twin rails leave a visible bolt channel along the top of the solid stock.
  for (const side of [-1, 1]) {
    parts.add(new BoxGeometry(.009, .012, .37), f.bone, { position: [side * .017, .053, -.035] });
    parts.add(tube([[0, .035, .15], [side * .09, .04, .155],
      [side * .2, .034, .13], [side * CROSSBOW.halfSpan, .03, .15]], detailed, .012), horn);
    parts.add(new CylinderGeometry(.015, .015, .033, detailed ? 8 : 4), f.leather,
      { position: [side * .06, .035, .15], rotation: [0, 0, Math.PI / 2] });
    parts.add(new SphereGeometry(.012, detailed ? 6 : 4, 3), horn,
      { position: [side * CROSSBOW.halfSpan, .03, .15] });
  }
  parts.add(new BoxGeometry(.037, .09, .035), timber, { position: [0, -.037, CROSSBOW.triggerZ] });
  parts.add(new BoxGeometry(.023, .033, .045), f.bronze, { position: [0, .035, -.145] });
  parts.add(new TorusGeometry(.025, .0035, 4, detailed ? 16 : 8, Math.PI * 1.5), f.bronze,
    { position: [0, -.028, -.14], rotation: [0, Math.PI / 2, .2] });
  parts.add(new BoxGeometry(.006, .025, .009), f.iron, { position: [0, -.018, -.148] });
  if (detailed) for (const z of [-.28, .04, .12])
    parts.add(new BoxGeometry(.053, .05, .009), f.bronze, { position: [0, .026, z] });
  return parts.build();
};

export const buildMayaJavelin = (detailed: boolean) => {
  const parts = createEquipmentParts(), f = createFinishes(detailed);
  parts.add(new CylinderGeometry(.008, .011, 1.13, detailed ? 8 : 4), f.darkWood,
    { position: [0, .035, 0] });
  parts.add(new ConeGeometry(.032, .15, 4), { color: "#73796a", rough: .84 },
    { position: [0, .66, 0], scale: [1, 1, .36] });
  parts.add(new CylinderGeometry(.013, .013, .09, detailed ? 8 : 4), f.leather,
    { position: [0, .55, 0] });
  parts.add(new CylinderGeometry(.014, .014, .105, detailed ? 8 : 4),
    { color: "#a34d36", rough: .88 });
  if (detailed) for (const y of [-.045, -.02, .005, .03, .055, .52, .54, .56, .58])
    parts.add(new TorusGeometry(.013, .0018, 3, 8), f.bone,
      { position: [0, y, 0], rotation: [Math.PI / 2, 0, 0] });
  return parts.build();
};

/** Short bolt, modeled along +Y like the shared arrow; the prop rotates it into the stock channel. */
export const buildCrossbowBolt = (detailed: boolean) => {
  const geometry = buildArrow(detailed);
  geometry.scale(1.15, .62, 1.15);
  return geometry;
};

/** A rigid-tipped Persian recurve and a longer, gently bowed Indigenous self bow. */
export const buildExpansionBow = (nation: WorkerNation, detailed: boolean) => {
  const parts = createEquipmentParts(), f = createFinishes(detailed);
  const persian = nation === "persian", tip = persian ? .34 : .4;
  const points: [number, number, number][] = persian
    ? [[0, -tip, STRING_Z], [0, -.28, -.115], [0, -.22, -.045], [0, -.1, .012],
      [0, 0, 0], [0, .1, .012], [0, .22, -.045], [0, .28, -.115], [0, tip, STRING_Z]]
    : [[0, -tip, STRING_Z], [0, -.25, -.045], [0, 0, 0], [0, .25, -.045], [0, tip, STRING_Z]];
  parts.add(tube(points, detailed, persian ? .012 : .009),
    persian ? { color: "#d6c092", rough: .48 } : f.darkWood);
  parts.add(new CylinderGeometry(.017, .017, .095, detailed ? 8 : 4),
    { color: persian ? "#254e83" : "#9d7550", rough: .82 });
  for (const side of [-1, 1]) parts.add(new SphereGeometry(.011, detailed ? 6 : 4, 3),
    persian ? f.bone : f.darkWood, { position: [0, side * tip, STRING_Z] });
  if (detailed) for (const side of [-1, 1]) for (const y of [.065, .085])
    parts.add(new TorusGeometry(.013, .002, 4, 8), persian ? f.bronze : f.bone,
      { position: [0, side * y, 0], rotation: [Math.PI / 2, 0, 0] });
  return parts.build();
};
