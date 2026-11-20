import { ConeGeometry, CylinderGeometry, ExtrudeGeometry } from "three";

import { VIKING_AXE_SHAFT_RADIUS } from "../../render-common/workers/viking-axe";
import type { WorkerNation } from "../../render-common/workers/worker-unit";
import { buildBlade } from "./military-equipment-blades";
import { createFinishes, type Finishes } from "./military-equipment-finishes";
import { BLADE_SECTIONS, loftBlade } from "./military-equipment-geometry";
import { createEquipmentParts, type Finish } from "./military-equipment-mesh";
import { beardedAxeHeadShape } from "./military-equipment-parts";

/**
 * Two-handed weapons of the heavy troops (owner, 2026-10-12): Roman long spatha, Viking Dane axe,
 * Nubian spear and Japanese two-handed katana. The right hand grips the origin and the left one
 * sits 0.15 further down the grip or haft, on the spear 0.28 ahead of it (worker-melee-moves.ts
 * SHAFT_HANDS / SPEAR_HANDS); the weapon runs along +Y with its edge or bit towards +X. Hafts carry
 * a dyed grip wrap under the left hand for the faction colour.
 */
type Parts = ReturnType<typeof createEquipmentParts>;
interface Forge { detailed: boolean; finishes: Finishes; parts: Parts }

const haft = (forge: Forge, bottom: number, top: number, finish: Finish, radius: number, wrap = -.155) => {
  const { detailed, finishes, parts } = forge, length = top - bottom;
  parts.add(new CylinderGeometry(radius, radius * 1.1, length, detailed ? 8 : 5, 1, !detailed), finish,
    { position: [0, bottom + length / 2, 0] });
  parts.add(new CylinderGeometry(radius * 1.25, radius * 1.25, .09, detailed ? 8 : 5, 1, true), finishes.dyed,
    { position: [0, wrap, 0] });
};

/** Viking Dane axe: long haft and the bearded head of the army icon with a bright edge. */
const vikingDaneAxe = (forge: Forge) => {
  const { detailed, finishes, parts } = forge, headY = .5, scale = .95;
  haft(forge, -.235, .6, finishes.wood, VIKING_AXE_SHAFT_RADIUS);
  const head = new ExtrudeGeometry(beardedAxeHeadShape(), { bevelEnabled: detailed, bevelSegments: 1,
    bevelSize: .005 / scale, bevelThickness: .004 / scale, curveSegments: detailed ? 6 : 2, depth: .016 / scale });
  parts.add(head, [finishes.iron, finishes.steel], { position: [.012, headY, -.008], scale: [scale, scale, scale] });
  parts.add(new CylinderGeometry(.022, .022, .08, detailed ? 8 : 5, 1, !detailed), finishes.iron,
    { position: [0, headY - .005, 0] });
  if (detailed) parts.add(new CylinderGeometry(.019, .019, .012, 8), finishes.iron, { position: [0, .62, 0] });
};

/** Nubian thrusting spear: long dark haft, bronze leaf blade with a midrib, dyed lashing, butt spike. */
const nubianSpear = (forge: Forge) => {
  const { detailed, finishes, parts } = forge, top = .72;
  haft(forge, -.5, top, finishes.darkWood, .014, .28);
  const section = detailed ? BLADE_SECTIONS.diamond : BLADE_SECTIONS.wedge;
  const leaf = [[top - .01, .012], [top + .05, .034], [top + .12, .028], [top + .2, 0]] as const;
  parts.add(loftBlade(leaf.map(([y, halfWidth], index) => ({
    halfThickness: index === leaf.length - 1 ? .002 : .007, halfWidth, x: 0, y
  })), section), finishes.bronze);
  parts.add(new CylinderGeometry(.018, .016, .05, detailed ? 8 : 5, 1, !detailed), finishes.bronze,
    { position: [0, top - .02, 0] });
  if (!detailed) return;
  parts.add(new CylinderGeometry(.017, .017, .03, 6, 1, true), finishes.dyed, { position: [0, top - .06, 0] });
  parts.add(new ConeGeometry(.015, .06, 6), finishes.bronze, { position: [0, -.53, 0], rotation: [Math.PI, 0, 0] });
};

const FORGES: Partial<Record<WorkerNation, (forge: Forge) => void>> = {
  nubian: nubianSpear,
  viking: vikingDaneAxe
};

/** One nation's two-handed weapon (the heavy troop's) as a single baked geometry. */
export const buildTwoHanded = (nation: WorkerNation, detailed: boolean) => {
  const forge = FORGES[nation];
  if (!forge) return buildBlade(nation, "twoHanded", detailed);
  const parts = createEquipmentParts();
  forge({ detailed, finishes: createFinishes(detailed), parts });
  return parts.build();
};
