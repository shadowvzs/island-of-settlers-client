import { DMath } from "../../shared/math/deterministic-math";
import type { Point3 } from "../buildings/building-recipe";
import type { AddPart } from "../buildings/roman-resource-workshops";

const LEATHER: Point3 = [0.46, 0.27, 0.13];
const DARK_LEATHER: Point3 = [0.28, 0.15, 0.07];
const SKIRT_RADIUS_X = 0.1;
const SKIRT_RADIUS_Z = 0.062;

/** Hanging leather strips (pteruges) below the belt: the classic Roman armour skirt. */
const addArmourSkirt = (part: AddPart, strips: number) => {
  for (let strip = 0; strip < strips; strip++) {
    const angle = (strip / strips) * Math.PI * 2;
    const position: Point3 = [DMath.sin(angle) * SKIRT_RADIUS_X, -0.145, DMath.cos(angle) * SKIRT_RADIUS_Z];
    const tint = strip % 2 ? LEATHER : DARK_LEATHER;
    part("paint", position, [0.04, 0.06, 0.012], 3, "box", [0, angle, 0], tint);
  }
};

/** Layered shoulder guards; the lower lame only on High. */
const addShoulderGuards = (part: AddPart, detailed: boolean) => {
  for (const side of [-1, 1]) {
    part("steel", [side * 0.11, 0.148, 0], [0.1, 0.055, 0.135], 3, "sphere");
    if (!detailed) continue;
    part("steel", [side * 0.132, 0.122, 0], [0.085, 0.045, 0.125], 3, "sphere");
    part("gold", [side * 0.11, 0.176, 0.045], [0.014, 0.014, 0.014], 3, "sphere");
  }
};

/**
 * Armour ware: a Roman cuirass standing upright, made by the Leatherworks.
 * Tapered leather torso with a metal chest plate, shoulder guards, belt and strip skirt so it reads
 * as armour (not a banded barrel) at stock size; extra lames, ridges and rivets only on High.
 */
export const addArmourCuirass = (part: AddPart, detailed: boolean) => {
  // Torso: broad chest over a narrower waist, with a dark neck opening and a steel collar.
  part("paint", [0, 0.075, 0], [0.25, 0.18, 0.15], 3, "sphere", undefined, LEATHER);
  part("paint", [0, -0.035, 0], [0.19, 0.17, 0.12], 3, "sphere", undefined, LEATHER);
  part("dark", [0, 0.163, 0], [0.085, 0.012, 0.055], 3, "cylinder");
  part("steel", [0, 0.163, 0], [0.105, 0.02, 0.07], 3, "ring");
  // Metal chest plate over the front, with a centre ridge.
  part("steel", [0, 0.08, 0.04], [0.2, 0.15, 0.08], 3, "sphere");
  part("dark", [0, 0.075, 0.08], [0.006, 0.11, 0.006], 3);
  addShoulderGuards(part, detailed);
  // Belt with buckle at the waist, then the skirt strips.
  part("dark", [0, -0.1, 0], [0.2, 0.03, 0.13], 3, "cylinder");
  part("gold", [0, -0.1, 0.066], [0.035, 0.026, 0.008], 3);
  addArmourSkirt(part, detailed ? 10 : 6);
  if (!detailed) return;
  // Abdominal lames and chest rivets.
  for (const y of [-0.02, -0.055]) part("steel", [0, y, 0.048], [0.13, 0.022, 0.03], 3, "sphere");
  for (const side of [-1, 1]) for (const y of [0.04, 0.11])
    part("gold", [side * 0.07, y, 0.074], [0.012, 0.012, 0.012], 3, "sphere");
};
