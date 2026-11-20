import { type Group, Mesh } from "three";

import { addHatchCoaming, addHatchGrating, addMooringCleats } from "./roman-ship-hull";
import { gunwaleLine, type HullForm,hullPoint } from "./ship-hull-loft";
import type { ShipKit } from "./ship-kit";

/**
 * High-detail fittings of the Japanese bune (owner 2026-10-13: as rich as the Roman ship): plank seams,
 * gilt studs along the lacquered bulwark, the through-beam ends (funabari), the hatch and mooring
 * cleats, a four-fluked grapnel anchor at the bow, a nobori banner, battened roof boards, twin
 * lanterns and the two stern sculling oars (ro). All outside the shared deck slots.
 */
const STUD_STEP = .12;

const addSeamsAndStuds = (kit: ShipKit, planking: Group, form: HullForm) => {
  for (const side of [-1, 1]) {
    for (const a of [.45, .6, .75, .9]) kit.curve(planking, "dark", gunwaleLine(form, side, 19, { a, out: .003 }), .003,
      24);
    for (let z = -.9; z <= .85; z += STUD_STEP) {
      const [x, y] = hullPoint(form, z / 2.2 + .5, -.1, side, .008);
      const stud = new Mesh(kit.medallion, kit.materials.gold);
      stud.scale.set(.013, .004, .013); stud.rotation.z = Math.PI / 2; stud.position.set(x, y, z); planking.add(stud);
    }
    // Through-beam ends standing out of the bulwark.
    for (const z of [-.5, -.1, .3, .65]) {
      const [x, y] = hullPoint(form, z / 2.2 + .5, .06, side, .02);
      kit.add(planking, "wood", [.05, .032, .032], [x, y, z]);
    }
  }
};

/** Four-fluked grapnel anchor hung on the starboard bow by its rope. */
const addGrapnelAnchor = (kit: ShipKit, planking: Group, form: HullForm) => {
  const t = .86, [x, y, z] = hullPoint(form, t, .25, 1, .05);
  kit.curve(planking, "iron", [[x, y + .07, z], [x, y - .07, z]], .008, 2);
  for (let fluke = 0; fluke < 4; fluke++) {
    const angle = fluke * Math.PI / 2 + Math.PI / 4, dx = Math.cos(angle) * .045, dz = Math.sin(angle) * .045;
    kit.curve(planking, "iron", [[x, y - .07, z], [x + dx * .8, y - .06, z + dz * .8], [x + dx, y - .02, z + dz]],
      .005, 4);
  }
  const [railX, railY] = hullPoint(form, t, -.22, 1, .01);
  kit.curve(planking, "dark", [[railX, railY, z - .02], [x, y + .12, z - .01], [x, y + .07, z]], .004, 4);
};

/** A tall nobori banner on the port quarter: lacquered pole, crossbar, vermilion head band and paper. */
const addBanner = (kit: ShipKit, planking: Group) => {
  const x = -.33, z = -.6;
  const pole = kit.add(planking, "lacquer", [.012, 1.05, .012], [x, .73, z]); pole.geometry = kit.pole;
  kit.add(planking, "lacquer", [.01, .01, .16], [x, 1.22, z - .08]);
  kit.add(planking, "paper", [.004, .4, .14], [x, 1.0, z - .085]);
  kit.add(planking, "vermilion", [.005, .06, .14], [x, 1.18, z - .085]);
  kit.add(planking, "lacquer", [.006, .12, .06], [x, .98, z - .085]);
};

/** The deck house roof: eave and ridge heights, half span and its stern (from) and bow (to) ends. */
export interface JapaneseRoof { eave: number; from: number; ridge: number; run: number; to: number }

/** Ribs (battens) across both roof slopes, as on the bune's board roof. */
const addRoofBattens = (kit: ShipKit, planking: Group, roof: JapaneseRoof) => {
  const rise = roof.ridge - roof.eave, slope = Math.hypot(roof.run, rise), tilt = Math.atan2(rise, roof.run);
  for (const side of [-1, 1]) for (let index = 0; index < 8; index++) {
    const z = roof.from + (index + .5) / 8 * (roof.to - roof.from);
    const batten = kit.add(planking, "dark", [slope, .012, .014],
      [side * roof.run / 2 + side * Math.sin(tilt) * .016, roof.eave + rise / 2 + Math.cos(tilt) * .016, z]);
    batten.rotation.z = -side * tilt;
  }
};

/** Two sculling oars (ro) trailing from the stern quarters. */
const addSternOars = (kit: ShipKit, planking: Group) => {
  for (const side of [-1, 1]) {
    kit.curve(planking, "wood", [[side * .3, .34, -.92], [side * .38, .12, -1.04], [side * .44, -.1, -1.13]], .01, 4);
    const blade = kit.add(planking, "wood", [.012, .16, .05], [side * .45, -.14, -1.14]);
    blade.rotation.set(.6, 0, -side * .3);
  }
};

const addLanterns = (kit: ShipKit, planking: Group) => {
  for (const x of [-.29, .29]) {
    const lantern = new Mesh(kit.medallion, kit.materials.vermilion);
    lantern.scale.set(.03, .06, .03); lantern.position.set(x, .55, -.7); planking.add(lantern);
    kit.add(planking, "lacquer", [.004, .03, .004], [x, .6, -.7]);
    kit.add(planking, "gold", [.034, .008, .034], [x, .515, -.7]);
  }
};

/** All High fittings; Minimal keeps the hatch coaming only. */
export const addJapaneseDetails = (kit: ShipKit, planking: Group, form: HullForm, roof: JapaneseRoof,
  fittings: Group = planking) => {
  addHatchCoaming(kit, planking, "lacquer");
  if (!kit.detailed) return;
  addHatchGrating(kit, planking, "wood");
  addMooringCleats(kit, planking, "lacquer", "gold");
  addSeamsAndStuds(kit, planking, form);
  addGrapnelAnchor(kit, fittings, form);
  addBanner(kit, planking);
  addRoofBattens(kit, planking, roof);
  addSternOars(kit, fittings);
  addLanterns(kit, planking);
};
