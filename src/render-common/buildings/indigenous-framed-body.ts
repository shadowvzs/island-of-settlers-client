import type { BuildingPart, BuildingRecipe, Point3 } from "./building-recipe";
import { addIndigenousSkirtPegs } from "./indigenous-tent-attachments";
import { type Add, doorGapOf, runBetween } from "./nation-kit-parts";

/** A load-bearing rectangular pole frame is completely enclosed by a softly draped textile sleeve. */
export const addIndigenousFramedBody = (add: Add, original: BuildingRecipe, centre: Point3,
  size: Point3, detailed: boolean, opening?: [number, number, number], portal = true,
  options?: { frameMargin: number; obstacles?: readonly BuildingPart[]; radius: number }) => {
  const [x, , z] = centre, [width, height, depth] = size, door = doorGapOf(original);
  const entrance: [number, number, number] = opening ?? [(door.left - x - .1) / width,
    (door.right - x + .1) / width, (door.top + .13) / height - .5];
  for (const jamb of [door.left - .1, door.right + .1]) add({
    position: [jamb, (door.top + .13) / 2, (door.z + z) / 2], shape: "box",
    size: [.012, door.top + .13, Math.max(.02, Math.abs(door.z - z))], stage: 2, surface: "cloth" });
  add({ indigenousEntrance: entrance, indigenousRoof: "framed", position: [x, height / 2, z],
    shape: "indigenous-roof", size, stage: 2, surface: "cloth",
    ...(options ? { indigenousFrameRadius: options.radius } : {}) });
  const margin = options?.frameMargin ?? .085;
  const px = Math.max(.04, Math.min(width * .43, width / 2 - margin));
  const pz = Math.max(.04, Math.min(depth * .43, depth / 2 - margin));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add({
    position: [x + sx * px, height / 2, z + sz * pz], shape: "box",
    size: [.045, height, .045], stage: 1, surface: "wood" });
  const beam = (from: Point3, to: Point3, thickness = .035) =>
    runBetween(add, from, to, [thickness, thickness], { stage: 2, surface: "wood" });
  // Top rails meet the platform underside. Side/rear braces complete the load path to the ground.
  for (const sx of [-1, 1]) {
    for (const y of [.09, height - .03]) beam([x + sx * px, y, z - pz],
      [x + sx * px, y, z + pz], y > .1 ? .06 : .035);
    beam([x + sx * px, .10, z - pz], [x + sx * px, height - .10, z + pz]);
  }
  for (const sz of [-1, 1]) beam([x - px, height - .03, z + sz * pz],
    [x + px, height - .03, z + sz * pz], .06);
  beam([x - px, .09, z - pz], [x + px, .09, z - pz]);
  beam([x - px, .10, z - pz], [x + px, height - .10, z - pz]);
  if (portal) {
    for (const jamb of [door.left - .045, door.right + .045]) add({
      position: [jamb, (door.top + .08) / 2, door.z], radialSegments: detailed ? 7 : 4,
      shape: "cylinder", size: [.035, door.top + .08, .035], stage: 2, surface: "wood" });
    add({ position: [(door.left + door.right) / 2, door.top + .09, door.z], shape: "box",
      size: [door.right - door.left + .13, .025, .025], stage: 2, surface: "wood" });
  }
  addIndigenousSkirtPegs(add, centre, size, "framed", original,
    [...original.parts.filter(part => part.stock), ...(options?.obstacles ?? [])], detailed, options?.radius);
};
