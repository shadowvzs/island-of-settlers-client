import type { BuildingPart, Point3 } from "./building-recipe";
import type { BuildingLevel } from "./levels/building-level";
import type { LevelKit } from "./levels/level-kit";

const mainRoom = (kit: LevelKit) => kit.site.parts.filter(part => part.shape === "persian-room" &&
  part.position[1] - part.size[1] / 2 < .1).sort((a, b) => b.size[0] * b.size[2] - a.size[0] * a.size[2])[0];

const curvedBand = (kit: LevelKit, room: BuildingPart, y: number, height: number, tint: Point3,
  stage: number, open: boolean) => {
  const opening = room.persianOpening ?? [-.22, .22, .3];
  const position: Point3 = [room.position[0], y, room.position[2]];
  const size: Point3 = [room.size[0] + .015, height, room.size[2] + .015];
  // Door-level bands keep the room's real opening; upper bands are open painted tubes so their
  // annular shell caps never read as glowing shelves or fight the wall.
  if (open) {
    kit.add({ compactGeometry: true, persianOpening: [opening[0], opening[1], .5],
      position, shape: "persian-room", size, stage, surface: "paint", tint });
    return;
  }
  kit.add({ position, radialSegments: 32, shape: "cylinder", openEnded: true,
    size, stage, surface: "paint", tint });
};

/** Upgrade details follow the actual oval wall and dome instead of the old rectangular building plan. */
export const addPersianCurvedLevel = (kit: LevelKit, level: BuildingLevel) => {
  const room = mainRoom(kit);
  if (!room) return;
  const bottom = room.position[1] - room.size[1] / 2, top = bottom + room.size[1];
  if (level === 2) {
    curvedBand(kit, room, bottom + .21, .09, [.035, .10, .43], 2, true);
    return;
  }
  if (level === 3) {
    // Above the cobalt band (its top edge is 1.6425): a 6 cm cream fascia up to the cornice.
    curvedBand(kit, room, top - .09, .06, [.96, .88, .72], 2, false);
    return;
  }
  const x = room.position[0], z = room.position[2];
  if (level === 4) {
    const roof = kit.site.topAt(x, z);
    if (roof === null) return;
    // A solid stepped civic crest repeats the fortress vocabulary without a tiny unsupported vault.
    kit.add({ position: [x, roof + .025, z], shape: "bevel-box",
      size: [.24, .13, .26], stage: 3, surface: "plaster" });
    kit.add({ position: [x, roof + .14, z], shape: "box",
      size: [.15, .10, .18], stage: 3, surface: "plaster" });
    kit.add({ position: [x, roof + .215, z], shape: "box",
      size: [.075, .05, .10], stage: 3, surface: "paint", tint: [.035, .10, .43] });
    return;
  }
  if (level !== 5) return;
  curvedBand(kit, room, top - .24, .045, [.7, .49, .25], 3, false);
  for (const angle of [Math.PI / 2, Math.PI * 1.5]) {
    const position: Point3 = [x + Math.sin(angle) * (room.size[0] / 2 + .012), top - .39,
      z + Math.cos(angle) * (room.size[2] / 2 + .012)];
    kit.add({ position, radialSegments: kit.detailed ? 16 : 8, rotation: [Math.PI / 2, angle, 0],
      shape: "cylinder", size: [.15, .025, .15], stage: 3, surface: "gold" });
  }
};
