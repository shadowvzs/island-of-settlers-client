import { type Group, LatheGeometry, Mesh, Vector2 } from "three";

import { SHIP_DECK } from "../../../render-common/ships/ship-deck-layout";
import { addHatchCoaming, addHatchGrating, addMooringCleats } from "./roman-ship-hull";
import { gunwaleLine, type HullForm,hullPoint } from "./ship-hull-loft";
import type { ShipKit } from "./ship-kit";

/**
 * High-detail fittings of the Nubian trader (owner 2026-10-13: as rich as the Roman ship): plank
 * seams, white lines between the painted bands, painted rosettes along the ochre band, a palm-wood
 * rail on stanchions, the hatch and mooring cleats, water jars lashed aft of the deck under the
 * awning's back edge, a fringe on the awning and painted bands on the mast. All outside the shared
 * deck slots.
 */
const addSeamsAndLines = (kit: ShipKit, planking: Group, form: HullForm, bandEdges: readonly number[]) => {
  for (const side of [-1, 1]) {
    for (const a of [.38, .54, .7, .86]) kit.curve(planking, "dark", gunwaleLine(form, side, 19, { a, out: .003 }),
      .003, 24);
    for (const a of bandEdges) kit.curve(planking, "paper", gunwaleLine(form, side, 19, { a, out: .003 }), .0035, 24);
  }
};

/** Painted rosettes on the ochre band: an indigo disc with a pale heart. */
const addRosettes = (kit: ShipKit, planking: Group, form: HullForm, a: number) => {
  for (const side of [-1, 1]) for (let z = -.75; z <= .8; z += .22) {
    for (const [material, radius, out] of [["indigo", .024, .004], ["paper", .011, .007]] as const) {
      const [x, y] = hullPoint(form, z / 2.2 + .5, a, side, out);
      const disc = new Mesh(kit.medallion, kit.materials[material]);
      disc.scale.set(radius, .003, radius); disc.rotation.z = Math.PI / 2; disc.position.set(x, y, z);
      planking.add(disc);
    }
  }
};

/** A light palm-wood rail on stanchions above the gunwale, outboard of the deck slots. */
const addRail = (kit: ShipKit, planking: Group, form: HullForm) => {
  for (const side of [-1, 1]) {
    const rail = Array.from({ length: 15 }, (_, index) => {
      const t = .12 + index / 14 * .76, [x, y, z] = hullPoint(form, t, 0, side, -.01);
      return [x, y + .09, z];
    });
    kit.curve(planking, "wood", rail, .007, 24);
    for (let index = 0; index < 15; index += 2) {
      const [x, y, z] = rail[index]!;
      kit.add(planking, "wood", [.012, .09, .012], [x!, y! - .045, z!]);
    }
  }
};

/** Water jars standing aft of the deck slots, under the awning's back edge. */
const addWaterJars = (kit: ShipKit, planking: Group) => {
  const profile = [[0, 0], [.02, .002], [.034, .03], [.036, .06], [.026, .095], [.014, .108], [.016, .118],
    [0, .118]].map(([radius, height]) => new Vector2(radius, height));
  const jar = kit.temp(new LatheGeometry(profile, 10));
  for (const [x, z] of [[-.08, -.9], [.08, -.9], [0, -.96]]) {
    const mesh = new Mesh(jar, kit.materials.ochre); mesh.position.set(x!, SHIP_DECK.floorY, z!);
    planking.add(mesh);
  }
};

/** Indigo tassels hanging along the awning's two side edges. */
const addAwningFringe = (kit: ShipKit, planking: Group) => {
  const { canopy } = SHIP_DECK, half = canopy.maxX + .03;
  for (const side of [-1, 1]) for (let z = canopy.minZ; z <= canopy.maxZ + .01; z += .045)
    kit.add(planking, "indigo", [.006, .04, .012], [side * half, canopy.roofY - .02, z]);
};

/** Ochre and indigo bands painted round the mast (rig). */
export const addNubianMastBands = (kit: ShipKit, rig: Group) => {
  if (!kit.detailed) return;
  for (const [y, material] of [[.5, "indigo"], [.56, "ochre"], [1.9, "indigo"], [1.96, "ochre"]] as const) {
    const band = kit.add(rig, material, [.036, .04, .036], [0, y, 0]); band.geometry = kit.medallion;
  }
};

/** All High fittings; Minimal keeps the hatch coaming only. */
export const addNubianDetails = (kit: ShipKit, planking: Group, form: HullForm, bands: { edges: readonly number[];
  ochre: number }) => {
  addHatchCoaming(kit, planking, "wood");
  if (!kit.detailed) return;
  addHatchGrating(kit, planking, "dark");
  addMooringCleats(kit, planking, "wood", "ochre");
  addSeamsAndLines(kit, planking, form, bands.edges);
  addRosettes(kit, planking, form, bands.ochre);
  addRail(kit, planking, form);
  addWaterJars(kit, planking);
  addAwningFringe(kit, planking);
};
