import type { BuildingPart } from "./building-recipe";
import type { NationBody } from "./nation-kit-classify";
import type { KitContext } from "./nation-kit-parts";
import { isPersianMine } from "./persian-mines";

/** Occupation glyphs move onto a backed keystone tablet when their old rectangular gable disappears. */
export const remountPersianOccupationSign = (context: KitContext, parts: BuildingPart[], body: NationBody,
  rounded: boolean) => {
  if (!rounded && !isPersianMine(context.typeId) && context.typeId !== 2) return;
  const { door, limit } = context, x = (door.left + door.right) / 2;
  const signs = parts.filter(part => !part.stock && part.surface === "paint" && part.size[2] <= .012 &&
    part.position[1] > door.top + .03 && part.position[2] > door.z - .03 &&
    Math.abs(part.position[0] - x) < .65 && Math.max(part.size[0], part.size[1]) < .75);
  if (!signs.length) return;
  const sourceX = (Math.min(...signs.map(part => part.position[0])) +
    Math.max(...signs.map(part => part.position[0]))) / 2;
  const sourceY = (Math.min(...signs.map(part => part.position[1])) +
    Math.max(...signs.map(part => part.position[1]))) / 2;
  const sourceZ = Math.min(...signs.map(part => part.position[2]));
  if (context.typeId === 2) {
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index]!;
      if (signs.includes(part)) parts[index] = { ...part,
        position: [part.position[0], part.position[1], part.position[2] + door.z + .08 - sourceZ] };
    }
    context.add({ position: [sourceX, sourceY, door.z + .035], shape: "bevel-box",
      size: [.40, .30, .08], stage: 3, surface: "plaster" });
    return;
  }
  const radius = Math.min(.62, limit.extentX - Math.abs(x) - .025);
  const porch = body.roofs.filter(roof => roof.min[2] >= door.z - .02 && x > roof.min[0] && x < roof.max[0]);
  let targetY = .94 + radius - .1;
  let targetZ = Math.min(limit.extentZ - .04, Math.max(door.z + .2, ...porch.map(roof => roof.max[2] - .025))) + .065;
  if (isPersianMine(context.typeId)) { targetY = 1.36; targetZ = .496; }
  if (context.typeId === 14) { targetY = 2.37; targetZ = .34; }
  if (context.typeId === 31) { targetY = 1.16; targetZ = door.z - .13; }
  const glyphWidth = Math.max(...signs.map(part => part.position[0] + part.size[0] / 2)) -
    Math.min(...signs.map(part => part.position[0] - part.size[0] / 2));
  const glyphHeight = Math.max(...signs.map(part => part.position[1] + part.size[1] / 2)) -
    Math.min(...signs.map(part => part.position[1] - part.size[1] / 2));
  const glyphScale = Math.min(1, .30 / glyphWidth, .16 / glyphHeight);
  const selected = new Set(signs);
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]!;
    if (!selected.has(part)) continue;
    parts[index] = { ...part, size: [part.size[0] * glyphScale, part.size[1] * glyphScale, part.size[2]],
      position: [(part.position[0] - sourceX) * glyphScale + x,
        (part.position[1] - sourceY) * glyphScale + targetY, part.position[2] + targetZ - sourceZ] };
  }
  context.add({ position: [x, targetY, targetZ - .03], shape: "bevel-box", size: [.35, .2, .065],
    stage: 3, surface: "plaster" });
};
