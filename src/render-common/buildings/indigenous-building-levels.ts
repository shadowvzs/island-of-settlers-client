import type { BuildingLevel } from "./levels/building-level";
import type { LevelKit } from "./levels/level-kit";

/** Upgrades dress the actual entrance poles and ground, never fictitious rectangular tent eaves. */
export const addIndigenousTentLevel = (kit: LevelKit, level: BuildingLevel) => {
  // Proper masonry rooms have a timber leaf and reveal, rather than an entrance pole to bind.
  if (!kit.site.recipe.tentDoor) return;
  // The former level-five mini cloth marker duplicated the generic hanging badges.
  if (level === 5) return;
  const { door } = kit.site;
  const jambX = level % 2 ? door.right + .045 : door.left - .045;
  const z = door.z;
  if (!kit.site.parts.some(part => part.shape === "indigenous-roof")) kit.add({
    position: [jambX, (door.top + .16) / 2, z], radialSegments: kit.detailed ? 7 : 4,
    shape: "cylinder", size: [.035, door.top + .16, .035], surface: "wood" });
  if (level === 2 || level === 3) {
    for (let index = 0; index < 3; index++) kit.add({
      position: [jambX, .22 + index * .085, z], radialSegments: kit.detailed ? 12 : 6,
      shape: "ring", size: [.058, .055, .058], surface: level === 2 ? "rope" : "hide" });
    return;
  }
  if (level === 4) {
    // Sewn triangular fringe is attached along the real doorway's rope lintel.
    for (let index = 0; index < 5; index++) kit.add({
      position: [door.left + (door.right - door.left) * (index + .5) / 5, door.top + .065, z],
      rotation: [0, 0, Math.PI], radialSegments: 3, shape: "cone",
      size: [.07, .065, .014], surface: "cloth" });
    return;
  }
};
