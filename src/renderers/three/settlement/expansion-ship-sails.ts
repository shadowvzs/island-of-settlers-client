import type { Group } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { SHIP_DECK_RIGGING } from "../../../render-common/ships/ship-deck-layout";
import { buildPersianLateenYard, createPersianLateenSail } from "./persian-lateen-sail";
import type { ShipKit } from "./ship-kit";
import type { ShipMaterialName } from "./ship-materials";
import { battenPanelWind, CLOTH_PORT, CLOTH_STARBOARD, createSailGrid, yardSailWind } from "./ship-sails";

/** The junk's panel puff between battens (the battens hold the shape; ship-sails battenPanelWind). */
const CHINESE_PANEL_PUFF = .006;
/** Two original asymmetric junk sails: broad feet, sloping narrow heads and individual batten panels. */
const chineseSailPoint = (u: number, v: number, aft = false) => {
  const from = -.28 + v * .10;
  const to = .87 - v * .55 + Math.sin(v * Math.PI) * .12;
  const z = from + (to - from) * u;
  const y = .68 + v * 1.35 + u * v * .25;
  const panel = v * (aft ? 6 : 8) % 1;
  const belly = Math.sin(v * Math.PI) * .045 + Math.sin(panel * Math.PI) * CHINESE_PANEL_PUFF;
  if (aft) return [-.085 - belly * .7, 1.03 + (y - .68) * .57, -.88 + z * .62];
  return [.085 + belly, y, z];
};
export const createChineseShipSail = (detailed: boolean) => {
  const main = createSailGrid(detailed ? 10 : 3, detailed ? 16 : 8, chineseSailPoint,
    battenPanelWind(8, CLOTH_STARBOARD, CHINESE_PANEL_PUFF));
  const aft = createSailGrid(detailed ? 8 : 3, detailed ? 12 : 6, (u, v) => chineseSailPoint(u, v, true),
    battenPanelWind(6, CLOTH_PORT, CHINESE_PANEL_PUFF * .7));
  const geometry = mergeGeometries([main, aft])!; main.dispose(); aft.dispose();
  return geometry;
};
export const createPersianShipSail = createPersianLateenSail;

const COTTON_BELLY = .12;
const createCottonSail = (detailed: boolean, indigenous: boolean) => {
  const width = indigenous ? 1.12 : 1.24, bottom = indigenous ? .83 : .72, height = indigenous ? .79 : 1.04;
  return createSailGrid(detailed ? 12 : 4, detailed ? 8 : 3, (u, v) => [(u - .5) * width * (.94 + v * .06),
    bottom + v * height, .09 + Math.sin(v * Math.PI) * COTTON_BELLY], yardSailWind(COTTON_BELLY));
};
export const createMayaShipSail = (detailed: boolean) => createCottonSail(detailed, false);
export const createIndigenousShipSail = (detailed: boolean) => createCottonSail(detailed, true);

export const CHINESE_MAST_FLAG_RISE = .58;

const mast = (kit: ShipKit, rig: Group, material: ShipMaterialName, extension = 0, standingRigging = true) => {
  const pole = kit.add(rig, material, [.03, 2.2 + extension, .03], [0, 1.25 + extension / 2, 0]); pole.geometry = kit.pole;
  if (kit.detailed && standingRigging) for (const [index, points] of SHIP_DECK_RIGGING.entries()) {
    // The old square yard endpoints do not belong to any of these new rigs.
    if ([1, 3, 4].includes(index) || Math.abs(points[0]![1]! - points[1]![1]!) < .0001) continue;
    kit.curve(rig, "dark", points, .005, 4);
  }
};
export const buildChineseShipRig = (kit: ShipKit, rig: Group) => {
  mast(kit, rig, "teak", CHINESE_MAST_FLAG_RISE);
  const aftMast = kit.add(rig, "teak", [.023, 1.9, .023], [0, 1.14, -.92]);
  aftMast.geometry = kit.pole;
  kit.add(rig, "dark", [.065, .035, .065], [0, .755, -.92]);
  for (const aft of [false, true]) {
    const battens = aft ? 6 : 8;
    for (let index = 0; index <= battens; index++) {
      const v = index / battens;
      const points = [0, .5, 1].map(u => {
        const point = chineseSailPoint(u, v, aft); return [point[0]! + .005, point[1]!, point[2]!];
      });
      kit.curve(rig, "dark", points, index === battens ? .011 : .005, kit.detailed ? 8 : 3);
    }
    if (kit.detailed) for (const u of [0, 1]) kit.curve(rig, "dark",
      [[0, aft ? 2.08 : 2.33, aft ? -.92 : 0], chineseSailPoint(u, 1, aft)], .003, 1);
  }
};
export const buildPersianShipRig = (kit: ShipKit, rig: Group) => {
  mast(kit, rig, "cedar", 0, false); buildPersianLateenYard(kit, rig);
};
const buildCottonRig = (kit: ShipKit, rig: Group, indigenous: boolean) => {
  const width = indigenous ? 1.12 : 1.24, top = indigenous ? 1.62 : 1.76;
  mast(kit, rig, "cedar");
  const yard = kit.add(rig, "cedar", [.017, width + .08, .017], [0, top + .008, .09]);
  yard.geometry = kit.pole; yard.rotation.z = Math.PI / 2;
  if (kit.detailed) for (const side of [-1, 1]) {
    kit.curve(rig, "dark", [[0, 2.28, 0], [side * (width / 2 + .015), top + .008, .09]], .004, 1);
    kit.curve(rig, "dark", [[side * width * .47, indigenous ? .83 : .72, .09],
      [side * .375, .25, -.04]], .004, 1);
  }
};
export const buildMayaShipRig = (kit: ShipKit, rig: Group) => buildCottonRig(kit, rig, false);
export const buildIndigenousShipRig = (kit: ShipKit, rig: Group) => {
  buildCottonRig(kit, rig, true);
};
