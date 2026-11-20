import type { BuildingPart, BuildingRecipe, Point3 } from "./building-recipe";
import { addIndigenousSkirtPegs } from "./indigenous-tent-attachments";
import { createTipiPortalPanels } from "./indigenous-tipi-portal";
import type { NationBody } from "./nation-kit-classify";
import { type Add, doorGapOf, runBetween } from "./nation-kit-parts";

/** One full-height lodge instead of a classical box wearing a conical roof. */
export const addIndigenousLodge = (add: Add, original: BuildingRecipe, body: NationBody,
  rounded: boolean, detailed: boolean, heightCap?: number, authoredRise?: number,
  groundObstacles: readonly BuildingPart[] = [], slopedEntrance = false) => {
  if (!body.roofs.length) return;
  const minX = Math.min(...body.roofs.map(roof => roof.min[0]));
  const maxX = Math.max(...body.roofs.map(roof => roof.max[0]));
  const minZ = Math.min(...body.roofs.map(roof => roof.min[2]));
  const maxZ = Math.max(...body.roofs.map(roof => roof.max[2]));
  const x = (minX + maxX) / 2, z = (minZ + maxZ) / 2;
  // Reserve a narrow skirt strip for real pegs, rather than enlarging the canonical plot.
  const width = Math.max(.55, maxX - minX - .08), depth = Math.max(.55, maxZ - minZ - .08);
  const naturalRise = rounded ? Math.max(1.15, Math.min(1.75, width * .8))
    : Math.max(1.55, Math.min(2.7, width * 1.25));
  const rise = Math.min(heightCap ?? Infinity, authoredRise ?? naturalRise);
  const door = doorGapOf(original), profile = rounded ? "earth" : "tipi";
  const entrance: [number, number, number] = [(door.left - x - .1) / width,
    (door.right - x + .1) / width, (door.top + .13) / rise - .5];
  // The skin recedes from the shared door plane. Sew side gussets to the flap so an oblique
  // view cannot see through the approach tunnel while the entrance is closed.
  if (slopedEntrance) for (const panel of createTipiPortalPanels([x, z], width, depth, rise, door)) add({
    position: panel.position, size: panel.size, clothPanelCorners: panel.corners,
    shape: "cloth-panel", stage: 2, surface: "cloth-reeds" });
  else for (const jamb of [door.left - .1, door.right + .1]) add({
    position: [jamb, (door.top + .13) / 2, (door.z + z) / 2], shape: "box",
    size: [.012, door.top + .13, Math.max(.02, Math.abs(door.z - z))], stage: 2, surface: "cloth" });
  add({ indigenousEntrance: entrance, indigenousRoof: profile, position: [x, rise / 2, z],
    shape: "indigenous-roof", size: [width, rise, depth], stage: 2,
    surface: "cloth" });
  // The existing door animation will move a fabric flap between two slender portal poles.
  for (const px of [door.left - .045, door.right + .045]) add({
    position: [px, (door.top + .08) / 2, door.z], radialSegments: detailed ? 7 : 4,
    shape: "cylinder", size: [.035, door.top + .08, .035], stage: 2, surface: "wood"
  });
  add({ position: [(door.left + door.right) / 2, door.top + .1, door.z], rotation: [0, 0, Math.PI / 2],
    radialSegments: detailed ? 6 : 3, shape: "cylinder", size: [.018, door.right - door.left + .12, .018],
    stage: 3, surface: "rope" });
  const beam = (from: Point3, to: Point3, thickness = .035) =>
    runBetween(add, from, to, [thickness, thickness], { stage: 3, surface: "wood" });
  if (!rounded) {
    const count = detailed ? 10 : 6;
    for (let index = 0; index < count; index++) {
      const angle = Math.PI * 2 * index / count;
      const u = Math.sin(angle) * .4, v = Math.cos(angle) * .4;
      // Entrance poles stand at the jambs; none crosses the worker corridor.
      if (v > 0 && u >= entrance[0] - .04 && u <= entrance[1] + .04) continue;
      // Main poles sit below the membrane. Only the crossing tips emerge above the peak.
      beam([x + u * width, .025, z + v * depth], [x, rise - .14, z], .025);
      beam([x, rise - .14, z], [x, rise - .015, z], .025);
      beam([x, rise - .015, z], [x - u * .14, rise + .18, z - v * .14], .025);
    }
    add({ position: [x, rise + .015, z], radialSegments: detailed ? 12 : 6,
      shape: "ring", size: [.13, .07, .13], stage: 3, surface: "rope" });
  } else {
    // The polar capsule skin is taut between pegs. A deep interior frame avoids any lath touching
    // the cloth, including between its native radial tessellation samples on Minimal.
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const foot: Point3 = [x + sx * width * .18, .025, z + sz * depth * .15];
      const head: Point3 = [foot[0], rise * .72, foot[2]];
      beam(foot, head, .03);
      beam(head, [x, rise - .1, z], .025);
    }
  }
  // A connected fabric hood follows the short approach between the shared flap and the lodge skin.
  if (!slopedEntrance && maxZ > door.z + .06) {
    const front = maxZ - .015, back = Math.min(door.z, front - .05);
    add({ position: [(door.left + door.right) / 2, door.top + .105, (front + back) / 2],
      shape: "box", size: [door.right - door.left + .19, .015, front - back], stage: 3, surface: "cloth" });
  }
  addIndigenousSkirtPegs(add, [x, 0, z], [width, rise, depth], profile, original,
    [...original.parts.filter(part => part.stock), ...groundObstacles], detailed);
};

/** Architectural leftovers must not become floating cornices, windows or upper cupola drums. */
export const isIndigenousLodgeProp = (part: BuildingPart) => {
  if (part.stock) return true;
  if (["stone", "cut-stone", "plaster", "mosaic"].includes(part.surface))
    return part.position[1] + part.size[1] / 2 < .15;
  if (part.shape === "civic-column-shaft" || part.shape === "ring" && part.position[1] > 1.4) return false;
  if (["wood", "paint", "leaf", "dark"].includes(part.surface) &&
    part.position[1] > .45 && part.size[1] < .35 && part.size[2] < .16 && !part.swayPivot) return false;
  if (part.surface === "dark" && part.size[1] > .12 && Math.min(...part.size) < .04) return false;
  if (["wood", "planks", "paint"].includes(part.surface) && part.stage <= 2 && part.position[1] > 1) return false;
  return true;
};
