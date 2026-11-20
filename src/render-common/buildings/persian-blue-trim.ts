import { srgbToLinear } from "../color";
import type { BuildingRecipe } from "./building-recipe";

/** Cobalt glazed tiles and painted bands contrast with warm pale structural masonry. */
const COBALT = srgbToLinear(.12, .30, .68);

export const withPersianBlueTrim = (recipe: BuildingRecipe): BuildingRecipe => {
  const doorX = recipe.door[0] + (recipe.doorDimensions?.width ?? .46) / 2;
  const parts = recipe.parts.map(part => !part.stock && part.shape === "occupation-roof" &&
    part.occupationRoof === "barrel" && Math.abs(part.position[0] - doorX) < .09 &&
    part.position[2] > recipe.door[2] - .25
    ? { ...part, roofSupport: true, surface: "roof" as const, tint: COBALT } : part);
  const rooms = parts.filter(part => part.shape === "persian-room" && !part.occupationRoof &&
    part.position[1] - part.size[1] / 2 < .1);
  const room = rooms.sort((a, b) => b.size[0] * b.size[2] - a.size[0] * a.size[2])[0];
  if (room) {
    const opening = room.persianOpening ?? [0, 0, -.5];
    const base = room.position[1] - room.size[1] / 2;
    parts.push({ compactGeometry: true, persianOpening: [opening[0], opening[1], .5], position: [room.position[0], base + .23, room.position[2]],
      shape: "persian-room", size: [room.size[0] + .012, .065, room.size[2] + .012], stage: 2,
      surface: "paint", tint: COBALT });
    // High band: an open painted tube (no annular ledges) proud of the curved wall.
    if (room.size[1] > .95) parts.push({
      position: [room.position[0], base + room.size[1] - .14, room.position[2]], shape: "cylinder",
      openEnded: true, radialSegments: 32,
      size: [room.size[0] + .012, .045, room.size[2] + .012], stage: 2, surface: "paint", tint: COBALT });
  }
  for (const part of recipe.parts) {
    if (part.stock) continue;
    if (part.shape === "bevel-box" && part.surface === "plaster" && part.size[1] > .8 &&
      part.size[0] >= .12 && part.size[0] <= .22 && part.size[2] > .3 &&
      Math.abs(part.position[0] - doorX) < .8) parts.push({ position: [part.position[0], part.position[1],
        part.position[2] + part.size[2] / 2 + .003], shape: "box",
      size: [.045, part.size[1] - .08, .012], stage: 2, surface: "paint", tint: COBALT });
    if (part.militaryTower && part.shape === "ring" && part.surface === "plaster" &&
      part.size[1] > .1 && part.size[1] < .25 && part.position[1] > 1.5) parts.push({ ...part,
      position: [part.position[0], part.position[1] - part.size[1] / 2 + .04, part.position[2]],
      size: [part.size[0] + .006, .035, part.size[2] + .006], surface: "paint", tint: COBALT });
  }
  return { ...recipe, parts };
};
