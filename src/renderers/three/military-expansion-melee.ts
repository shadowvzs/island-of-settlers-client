import { BoxGeometry, CylinderGeometry, ExtrudeGeometry, IcosahedronGeometry, Shape, SphereGeometry } from "three";

import type { BuildingFirstNation } from "../../render-common/workers/worker-nation";
import type { BladeKind } from "./military-equipment-blades";
import { createFinishes } from "./military-equipment-finishes";
import { BLADE_SECTIONS, loftBlade } from "./military-equipment-geometry";
import { createEquipmentParts, type Finish } from "./military-equipment-mesh";

type Parts = ReturnType<typeof createEquipmentParts>;
type Forge = { detailed: boolean; finishes: ReturnType<typeof createFinishes>; parts: Parts };

const shaft = ({ detailed, parts }: Forge, bottom: number, top: number, radius: number, finish: Finish) =>
  parts.add(new CylinderGeometry(radius, radius * 1.12, top - bottom, detailed ? 10 : 5), finish,
    { position: [0, (top + bottom) / 2, 0] });

const binding = (forge: Forge, y: number, length: number, radius = .019) => {
  const { detailed, finishes, parts } = forge;
  parts.add(new CylinderGeometry(radius, radius, length, detailed ? 10 : 5), finishes.leather,
    { position: [0, y, 0] });
  if (!detailed) return;
  for (let ring = 0; ring < 4; ring++)
    parts.add(new CylinderGeometry(radius * 1.05, radius * 1.05, .003, 8), finishes.bone,
      { position: [0, y - length * .36 + ring * length * .24, 0] });
};

const sword = (forge: Forge, nation: "chinese" | "persian", kind: BladeKind) => {
  const { detailed, finishes, parts } = forge, heavy = kind === "twoHanded";
  let length = .43;
  if (kind === "cavalry") length = .53;
  if (heavy) length = .66;
  const width = nation === "chinese" ? .025 : .021;
  const profile = [[.045, width], [.045 + length * .65, width],
    [.045 + length * .91, width * .8], [.045 + length, 0]] as const;
  parts.add(loftBlade(profile.map(([y, halfWidth]) => ({ halfThickness: .005, halfWidth, x: 0, y })),
    nation === "chinese" ? BLADE_SECTIONS.singleEdge : BLADE_SECTIONS.diamond), finishes.steel);
  const bottom = heavy ? -.215 : -.083;
  shaft(forge, bottom, .027, .014, finishes.darkWood);
  binding(forge, (bottom + .017) / 2, .017 - bottom, .016);
  if (nation === "chinese") {
    parts.add(new CylinderGeometry(.042, .042, .012, detailed ? 14 : 6), finishes.bronze,
      { position: [0, .031, 0], scale: [1, 1, .7] });
    parts.add(new BoxGeometry(.033, .025, .016), finishes.gold, { position: [0, .053, 0] });
  } else parts.add(new BoxGeometry(.1, .018, .025), finishes.gold, { position: [0, .032, 0] });
  parts.add(new SphereGeometry(.023, detailed ? 10 : 5, detailed ? 6 : 3), finishes.bronze,
    { position: [0, bottom - .012, 0], scale: [1.2, .65, .7] });
};

const tomahawk = (forge: Forge) => {
  const { detailed, finishes, parts } = forge;
  shaft(forge, -.1, .365, .014, finishes.wood);
  // A chipped stone wedge is closed on both flats and widens towards its cutting bit.
  parts.add(loftBlade([
    { halfThickness: .014, halfWidth: .012, x: -.018, y: .255 },
    { halfThickness: .025, halfWidth: .075, x: .035, y: .29 },
    { halfThickness: .014, halfWidth: .081, x: .035, y: .342 },
    { halfThickness: .004, halfWidth: 0, x: .02, y: .365 },
  ], BLADE_SECTIONS.diamond), { color: "#8f9692", rough: .91 });
  binding(forge, .307, .08, .025);
  binding(forge, -.015, .115, .017);
  if (detailed) parts.add(new BoxGeometry(.007, .12, .004), finishes.dyed,
    { position: [.013, -.108, 0], rotation: [0, 0, -.18] });
};

const mayaBlade = (forge: Forge, heavy: boolean) => {
  const { detailed, finishes, parts } = forge;
  if (heavy) {
    shaft(forge, -.22, .45, .016, finishes.darkWood);
    const outline = new Shape();
    outline.moveTo(-.035, .33); outline.lineTo(.018, .312); outline.lineTo(.115, .32);
    outline.lineTo(.145, .37); outline.lineTo(.13, .418); outline.lineTo(.025, .425);
    outline.lineTo(-.035, .4); outline.closePath();
    const head = new ExtrudeGeometry(outline, { depth: .034, bevelEnabled: detailed,
      bevelSegments: 1, bevelSize: .003, bevelThickness: .002, curveSegments: 1, steps: 1 });
    const position = head.getAttribute("position");
    for (let at = 0; at < position.count; at++) {
      const distance = Math.max(0, Math.min(1, (position.getX(at) + .035) / .18));
      position.setZ(at, (position.getZ(at) - .017) * (1 - distance * .95));
    }
    head.computeVertexNormals();
    parts.add(head, { color: "#91968b", rough: .94 });
    binding(forge, .37, .09, .024);
    binding(forge, -.11, .18);
    return;
  }
  shaft(forge, -.09, .073, .017, finishes.darkWood);
  parts.add(new BoxGeometry(.076, .27, .026), finishes.wood, { position: [0, .2, 0] });
  const teeth = detailed ? 8 : 4;
  for (const side of [-1, 1]) for (let tooth = 0; tooth < teeth; tooth++) {
    const y = .082 + (tooth + .5) * .237 / teeth;
    parts.add(new IcosahedronGeometry(1, 0), { color: "#5c6263", metal: .12, rough: .47 },
      { position: [side * .043, y, 0], scale: [.017, .237 / teeth * .47, .012] });
  }
  parts.add(new SphereGeometry(.022, detailed ? 8 : 4, detailed ? 5 : 2), finishes.bone,
    { position: [0, -.105, 0], scale: [1, .65, 1] });
  binding(forge, -.012, .11);
};

const persianMace = (forge: Forge) => {
  const { detailed, finishes, parts } = forge;
  shaft(forge, -.22, .47, .015, finishes.darkWood);
  binding(forge, -.105, .2);
  parts.add(new SphereGeometry(.055, detailed ? 10 : 6, detailed ? 7 : 3), finishes.iron,
    { position: [0, .43, 0], scale: [1, 1.05, 1] });
  for (let lobe = 0; lobe < 6; lobe++) {
    const angle = lobe / 6 * Math.PI * 2;
    parts.add(new SphereGeometry(.035, detailed ? 8 : 4, detailed ? 6 : 2), finishes.iron,
      { position: [Math.cos(angle) * .035, .43, Math.sin(angle) * .035], scale: [.95, 1.5, .95] });
  }
  parts.add(new SphereGeometry(.018, 6, 3), finishes.gold, { position: [0, .5, 0] });
};

/** Hand at origin, cutting direction +X, shaft +Y. Indigenous heavy uses TWO instances. */
export const buildExpansionMelee = (nation: BuildingFirstNation, kind: BladeKind, detailed: boolean) => {
  const parts = createEquipmentParts(), forge = { detailed, finishes: createFinishes(detailed), parts };
  if (nation === "chinese") sword(forge, nation, kind);
  else if (nation === "persian" && kind === "twoHanded") persianMace(forge);
  else if (nation === "persian") sword(forge, nation, kind);
  else if (nation === "indigenous") tomahawk(forge);
  else mayaBlade(forge, kind === "twoHanded");
  return parts.build();
};
