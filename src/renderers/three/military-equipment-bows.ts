import { BoxGeometry, CatmullRomCurve3, ConeGeometry, CylinderGeometry, TubeGeometry, Vector3 } from "three";

import type { WorkerNation } from "../../render-common/workers/worker-unit";
import { createFinishes } from "./military-equipment-finishes";
import { createEquipmentParts, type Finish } from "./military-equipment-mesh";

/**
 * Archers' bows: the bow hand at the origin, limbs along Y, the string plane at z = STRING_Z
 * (drawn per soldier as a line). The arrow is its own geometry so each archer can nock it.
 */
export const STRING_Z = -.075;

/** Upper and lower limb tips; the Japanese yumi is long and gripped below its middle. */
export const bowSpan = (nation: WorkerNation) =>
  nation === "japanese" ? { low: -.25, tall: .48 } :
    { low: nation === "indigenous" ? -.4 : -.34, tall: nation === "indigenous" ? .4 : .34 };

const LIMB_FINISH: Record<WorkerNation, Finish> = {
  maya: { color: "#b08a5a", rough: .5 },
  persian: { color: "#b08a5a", rough: .5 },
  chinese: { color: "#b08a5a", rough: .5 },
  indigenous: { color: "#b08a5a", rough: .5 },
  japanese: { color: "#2a1d16", metal: .1, rough: .3 },
  nubian: { color: "#6e4426", rough: .62 },
  roman: { color: "#b08a5a", rough: .5 },
  viking: { color: "#b27a45", rough: .66 }
};

/** One nation's bow (limbs, dyed grip, tip wraps) as a single baked geometry. */
export const buildBow = (nation: WorkerNation, detailed: boolean) => {
  const parts = createEquipmentParts(), finishes = createFinishes(detailed);
  const { low, tall } = bowSpan(nation), recurve = nation === "roman" ? .035 : 0;
  const curve = new CatmullRomCurve3([new Vector3(0, low, STRING_Z), new Vector3(0, low * .7, -.035 + recurve),
    new Vector3(0, 0, 0), new Vector3(0, tall * .7, -.035 + recurve), new Vector3(0, tall, STRING_Z)]);
  parts.add(new TubeGeometry(curve, detailed ? 20 : 6, .011, detailed ? 5 : 3, false), LIMB_FINISH[nation]);
  parts.add(new CylinderGeometry(.018, .018, .095, detailed ? 8 : 4, 1, !detailed), finishes.dyed);
  const wrap = nation === "japanese" ? finishes.dyed : finishes.bronze;
  for (const y of detailed ? [low * .83, tall * .83] : [])
    parts.add(new CylinderGeometry(.014, .014, .027, 6), wrap, { position: [0, y, -.048] });
  return parts.build();
};

/** Nocked arrow along +Y: shaft, iron point and three fletchings. */
export const buildArrow = (detailed: boolean) => {
  const parts = createEquipmentParts(), finishes = createFinishes(detailed);
  parts.add(new CylinderGeometry(.004, .004, .4, detailed ? 5 : 3, 1, true), finishes.wood);
  parts.add(new ConeGeometry(.014, .035, 4, 1, !detailed), finishes.iron, { position: [0, .21, 0] });
  const feathers = detailed ? [0, Math.PI * .66, Math.PI * 1.33] : [];
  for (const angle of feathers)
    parts.add(new BoxGeometry(.012, .045, .002), finishes.bone, { position: [0, -.165, 0], rotation: [0, angle, 0] });
  return parts.build();
};
