import { BoxGeometry, ConeGeometry, PlaneGeometry } from "three";

import type { WorkerNation } from "../../render-common/workers/worker-unit";
import { createFinishes, type Finishes } from "./military-equipment-finishes";
import {
  BLADE_SECTIONS,
  curvedPlate,
  lathe,
  loftBlade,
  ovalPlate,
  type ShieldPlate
} from "./military-equipment-geometry";
import { createEquipmentParts, type Finish } from "./military-equipment-mesh";

/**
 * Nation shields. The hand grips the origin behind the board (centre grip behind the boss or
 * spine), the face looks along +Z and the long axis is +Y (worker-melee-weapon.ts orientShield).
 * High carries real bosses, rivets, spine and bars; Minimal paints them into the atlas.
 */
type Parts = ReturnType<typeof createEquipmentParts>;
interface Forge { detailed: boolean; finishes: Finishes; parts: Parts }

/** The back of the board stands this far in front of the gripping hand; the boss covers the fist. */
const BACK = .032;
const THICKNESS = .012;
/** Faction-dyed field paint (scutum rib). */
const DYED_FIELD: Finish = { color: "#e4e4e4", livery: 1, rough: .6 };

const addPlate = (parts: Parts, plate: ShieldPlate, finishes: { back: Finish; front: Finish; rim: Finish }) => {
  parts.add(plate.front, finishes.front);
  parts.add(plate.back, finishes.back);
  parts.add(plate.rim, finishes.rim);
};

/** Bowl-shaped boss facing +Z from a [radius, height] profile; Minimal uses a low pyramid. */
const addBoss = (forge: Forge, profile: readonly (readonly [number, number])[], z: number, finish: Finish) => {
  const radius = profile[0]![0], height = profile.at(-1)![1];
  const boss = forge.detailed ? lathe(profile, 12) : new ConeGeometry(radius, height, 6, 1, true);
  const lift = forge.detailed ? 0 : height / 2;
  forge.parts.add(boss, finish, { position: [0, 0, z + lift], rotation: [Math.PI / 2, 0, 0] });
};

/** Curved Roman scutum: dyed field with painted thunderbolts, bronze edging, spine and umbo. */
const romanScutum = (forge: Forge) => {
  const { detailed, finishes, parts } = forge, curve = .05;
  const plate = curvedPlate({ back: BACK, columns: detailed ? 8 : 3, curve, height: .52, thickness: THICKNESS,
    width: .3 });
  addPlate(parts, plate, { back: finishes.leather, front: { color: "#ffffff", paint: "romanScutum", rough: .62 },
    rim: finishes.bronze });
  const face = BACK + THICKNESS + curve;
  if (detailed) {
    parts.add(new BoxGeometry(.022, .5, .008), DYED_FIELD, { position: [0, 0, face] });
    parts.add(new BoxGeometry(.1, .1, .006), finishes.bronze, { position: [0, 0, face - .001] });
  }
  addBoss(forge, [[.048, 0], [.047, .014], [.04, .028], [.026, .038], [0, .042]], face, finishes.bronze);
};

/** Viking round shield: painted linden boards, rawhide rim, iron rivets and a domed iron boss. */
const vikingRound = (forge: Forge) => {
  const { detailed, finishes, parts } = forge, dome = .03, radius = .25;
  const bulge = (distance: number) => dome * (1 - distance * distance);
  const plate = ovalPlate({ back: BACK, bulge, radiusX: radius, radiusY: radius, rings: detailed ? 3 : 1,
    segments: detailed ? 24 : 10, thickness: THICKNESS });
  addPlate(parts, plate, { back: finishes.wood, front: { color: "#ffffff", paint: "vikingBoards", rough: .66 },
    rim: finishes.leather });
  const face = BACK + THICKNESS;
  addBoss(forge, [[.07, 0], [.068, .007], [.05, .012], [.048, .034], [.036, .056], [.016, .068], [.002, .071]],
    face + dome - .004, finishes.iron);
  if (!detailed) return;
  for (let rivet = 0; rivet < 16; rivet++) {
    const angle = rivet / 16 * Math.PI * 2, distance = .86;
    parts.add(new ConeGeometry(.008, .006, 4, 1, true), finishes.iron, {
      position: [Math.cos(angle) * radius * distance, Math.sin(angle) * radius * distance,
        face + bulge(distance) + .002],
      rotation: [Math.PI / 2, 0, 0]
    });
  }
};

/** Nubian tall oval cowhide on a wooden spine, the rim laced with dyed rawhide. */
const nubianOval = (forge: Forge) => {
  const { detailed, finishes, parts } = forge, dome = .035, height = .26;
  const bulge = (distance: number) => dome * (1 - distance * distance);
  const plate = ovalPlate({ back: BACK, bulge, radiusX: .14, radiusY: height, rings: detailed ? 3 : 1,
    segments: detailed ? 20 : 10, thickness: THICKNESS });
  addPlate(parts, plate, { back: finishes.leather, front: { color: "#ffffff", paint: "nubianHide", rough: .75 },
    rim: finishes.dyed });
  if (!detailed) return;
  const spine = Array.from({ length: 9 }, (_, step) => {
    const y = (step / 8 - .5) * 2 * (height - .012), end = step === 0 || step === 8;
    return { halfThickness: .007, halfWidth: end ? 0 : .012, x: 0, y,
      z: BACK + THICKNESS + bulge(Math.abs(y) / height) + .004 };
  });
  parts.add(loftBlade(spine, BLADE_SECTIONS.rectangle), finishes.darkWood);
};

/** A flat board has no boss to cover the fist: it stands off the hand on a grip block. */
const TATE_STANDOFF = .075;

/** Japanese tate: a planked board with lacquered top and bottom bars, iron bands and a dyed mon. */
const japaneseTate = (forge: Forge) => {
  const { detailed, finishes, parts } = forge, width = .3, height = .46, depth = .03;
  const center = TATE_STANDOFF + depth / 2, front = center + depth / 2 + .0015;
  parts.add(new BoxGeometry(width, height, depth), finishes.darkWood, { position: [0, 0, center] });
  parts.add(new BoxGeometry(.05, .05, TATE_STANDOFF - BACK), finishes.lacquer,
    { position: [0, 0, (TATE_STANDOFF + BACK) / 2] });
  parts.add(new PlaneGeometry(width, height), { color: "#ffffff", paint: "japaneseTate", rough: .55 },
    { position: [0, 0, front] });
  if (!detailed) return;
  for (const y of [-1, 1])
    parts.add(new BoxGeometry(width + .014, .034, depth + .012), finishes.lacquer, { position: [0, y * .213, center] });
  for (const y of [-.11, .11]) {
    parts.add(new BoxGeometry(width + .006, .014, depth + .008), finishes.iron, { position: [0, y, center] });
    for (const x of [-.1, 0, .1])
      parts.add(new ConeGeometry(.007, .006, 4, 1, true), finishes.iron,
        { position: [x, y, front + .006], rotation: [Math.PI / 2, 0, 0] });
  }
};

const FORGES: Record<WorkerNation, (forge: Forge) => void> = {
  maya: romanScutum,
  persian: romanScutum,
  chinese: romanScutum,
  indigenous: romanScutum,
  japanese: japaneseTate,
  nubian: nubianOval,
  roman: romanScutum,
  viking: vikingRound
};

/** One nation's shield as a single baked geometry. */
export const buildShield = (nation: WorkerNation, detailed: boolean) => {
  const parts = createEquipmentParts();
  FORGES[nation]({ detailed, finishes: createFinishes(detailed), parts });
  return parts.build();
};
