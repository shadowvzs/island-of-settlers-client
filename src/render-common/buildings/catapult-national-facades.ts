import type { WorkerNation } from "../workers/worker-nation";
import type { BuildingPart, Point3 } from "./building-recipe";
import { addAdditionalCatapultFacade } from "./catapult-additional-facades";
import { CATAPULT_SHAFT_HEIGHT } from "./catapult-dimensions";

/** National shaft architecture only: never alter the shared deck, opening, engine or crew contacts. */
export const addCatapultNationalFacade = (parts: BuildingPart[], nation: WorkerNation, detailed: boolean) => {
  const add = (surface: BuildingPart["surface"], position: Point3, size: Point3, rotation?: Point3) =>
    parts.push({ surface, position, size, rotation, stage: 2, worldUv: 1.8,
      shape: detailed ? "bevel-box" : "box" });
  if (nation === "roman") {
    // Rusticated front piers and a visible radial relieving arch above the unchanged full-height lintel.
    for (const side of [-1, 1]) {
      add("cut-stone", [side * .605, .17, .72], [.18, .12, .12]);
      add("cut-stone", [side * .605, CATAPULT_SHAFT_HEIGHT - .18, .72], [.18, .10, .12]);
      for (let course = 0; course < 6; course++)
        add("cut-stone", [side * .605, .38 + course * .32, .72], [.14, .27, .11]);
    }
    for (let stone = 0; stone < 7; stone++) {
      const angle = stone / 6 * Math.PI;
      add("cut-stone", [Math.cos(angle) * .35, .94 + Math.sin(angle) * .35, .735],
        [.14, .115, .12], [0, 0, angle - Math.PI / 2]);
    }
    return;
  }
  if (nation !== "japanese") { addAdditionalCatapultFacade(parts, nation, detailed); return; }
  // Exposed post-and-beam infill, with back/side diagonal braces; the front opening remains unobstructed.
  for (const side of [-1, 1]) {
    for (const z of [-.61, .61])
      add("wood", [side * .70, CATAPULT_SHAFT_HEIGHT / 2, z], [.05, CATAPULT_SHAFT_HEIGHT, .08]);
    for (const y of [.22, 1.35, CATAPULT_SHAFT_HEIGHT - .10])
      add("wood", [side * .70, y, 0], [.05, .07, 1.30]);
    add("wood", [side * .70, .79, 0], [.05, 1.26, .055], [side * .47, 0, 0]);
  }
  for (const x of [-.60, .60]) add("wood", [x, CATAPULT_SHAFT_HEIGHT / 2, .72], [.065, CATAPULT_SHAFT_HEIGHT, .07]);
  for (const y of [1.35, CATAPULT_SHAFT_HEIGHT - .10]) add("wood", [0, y, .72], [1.26, .075, .07]);
  // Rear bracing joins real rear posts/rails, instead of ending unsupported outside the wall.
  for (const x of [-.60, .60]) add("wood", [x, CATAPULT_SHAFT_HEIGHT / 2, -.725],
    [.065, CATAPULT_SHAFT_HEIGHT, .065]);
  for (const y of [.22, 1.35, CATAPULT_SHAFT_HEIGHT - .10]) add("wood", [0, y, -.725], [1.26, .075, .065]);
  const braceRise = CATAPULT_SHAFT_HEIGHT - .32;
  add("wood", [0, (CATAPULT_SHAFT_HEIGHT + .12) / 2, -.725],
    [.065, Math.hypot(1.2, braceRise), .055], [0, 0, -Math.atan2(1.2, braceRise)]);
  if (detailed) for (const side of [-1, 1]) for (const y of [1.35, CATAPULT_SHAFT_HEIGHT - .10])
    add("iron", [side * .60, y, .765], [.023, .023, .018]);
};
