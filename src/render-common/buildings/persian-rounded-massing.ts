import type { BuildingDefinition } from "./building-catalog";
import type { BuildingPart, BuildingRecipe, Point3 } from "./building-recipe";
import type { NationBody, RoofEnvelope } from "./nation-kit-classify";
import { envelopeCenter, envelopeSize, type KitContext } from "./nation-kit-parts";
import { addPersianVaultCap } from "./persian-vault-room";
import { addPersianVaultSupports } from "./persian-vault-supports";

const KEEP_STRUCTURAL_TOWERS = new Set([2, 4, 9, 10, 11, 12, 13, 35]);
const DOMED_OCCUPATIONS = new Set([0, 1, 5, 6, 8, 15, 20, 23, 24, 29, 34, 37, 40, 57, 58, 59, 60, 61, 62]);

export const usesPersianRoundedMassing = (definition: BuildingDefinition, body: NationBody) =>
  !KEEP_STRUCTURAL_TOWERS.has(definition.id) && body.walls.length > 0 && body.roofs.length > 0;

const area = (roof: RoofEnvelope) => (roof.max[0] - roof.min[0]) * (roof.max[2] - roof.min[2]);
const PALE: Point3 = [.94, .86, .71];

interface Room { x: number; z: number; width: number; depth: number; height: number }

const roomContainsEntrance = (door: KitContext["door"], room: Room) =>
  door.left >= room.x - room.width / 2 && door.right <= room.x + room.width / 2 &&
  Math.abs(room.z + room.depth / 2 - door.z) < .15;

const addRoom = (context: KitContext, room: Room, base: number, height: number,
  openingTop: number, closed = false) => {
  const { add, door } = context;
  const opening: [number, number, number] = closed ? [0, 0, -.49] :
    [(door.left - room.x - .13) / room.width, (door.right - room.x + .13) / room.width,
      (openingTop - base) / height - .5];
  add({ compactGeometry: true, persianOpening: opening, position: [room.x, base + height / 2, room.z], shape: "persian-room",
    size: [room.width, height, room.depth], stage: 1, surface: "plaster" });
};

const addRoundWindows = (context: KitContext, room: Room) => {
  const { add, detailed } = context, count = detailed ? 3 : 2;
  for (const angle of [Math.PI * .58, Math.PI * 1.42, Math.PI].slice(0, count)) {
    const x = room.x + Math.sin(angle) * room.width * .5, z = room.z + Math.cos(angle) * room.depth * .5;
    const position: Point3 = [x, Math.min(room.height - .22, .72), z];
    add({ position, rotation: [0, angle, 0], shape: "window-shadow", size: [.14, .24, .025],
      stage: 2, surface: "dark" });
    if (!detailed) continue;
    for (const side of [-1, 1]) add({
      position: [x + Math.cos(angle) * side * .09, position[1], z - Math.sin(angle) * side * .09],
      rotation: [0, angle, 0], shape: "bevel-box", size: [.035, .29, .04], stage: 2, surface: "plaster"
    });
  }
};

/** The prominent vaulted entrance grows in front of an oval chamber, leaving the shared leaf recessed. */
const addIwan = (context: KitContext, body: NationBody, room: Room, definition: BuildingDefinition) => {
  const { add, detailed, door, limit } = context, x = (door.left + door.right) / 2;
  const radius = Math.min(.62, limit.extentX - Math.abs(x) - .025);
  if (radius < .41 || definition.id === 31 || definition.id === 14) return;
  const inner = Math.min(.43, radius - .12), spring = .94;
  const porch = body.roofs.filter(roof => roof.min[2] >= door.z - .02 && x > roof.min[0] && x < roof.max[0]);
  const front = Math.min(limit.extentZ - .04, Math.max(door.z + .2, ...porch.map(roof => roof.max[2] - .025)));
  const back = Math.min(door.z - .32, room.z + room.depth * .32), length = front - back;
  const rise = radius / .87;
  for (const side of [-1, 1]) add({ position: [x + side * (inner + (radius - inner) / 2), spring / 2,
    (front + back) / 2], shape: "bevel-box", size: [radius - inner, spring, length],
    stage: 1, surface: "plaster" });
  add({ occupationRoof: "barrel", position: [x, spring + .44 * rise, (front + back) / 2],
    radialSegments: context.detailed ? 16 : 6, shape: "occupation-roof", size: [radius * 2, rise, length], stage: 3, surface: "roof" });
  for (let index = 0; index < 6; index++) add({ innerRadius: inner / (radius * 2),
    position: [x, spring, front], rotation: [Math.PI / 2, 0, Math.PI / 2 + index * Math.PI / 6],
    shape: "stone-arc", size: [radius * 2, .10, radius * 2], stage: 2, surface: "plaster" });
  if (!detailed) return;
  for (const side of [-1, 1]) add({ position: [x + side * (radius - .04), .7, front - .035],
    shape: "bevel-box", size: [.07, 1.4, .16], stage: 2, surface: "paint", tint: PALE });
};

/** Round rooms and long connected vaults replace the Roman rectangular facade and roof volumes. */
export const addPersianRoundedMassing = (context: KitContext, original: BuildingRecipe,
  definition: BuildingDefinition, body: NationBody): ReadonlySet<RoofEnvelope> => {
  const ordered = [...body.roofs].filter(roof => !roof.round).sort((a, b) => area(b) - area(a));
  const main = ordered[0];
  if (!main) return new Set();
  const { depth, width } = envelopeSize(main), centre = envelopeCenter(main), door = context.door;
  const ground = body.walls.filter(wall => wall.base < .2);
  let height = Math.max(1.05, ...ground.map(wall => wall.height));
  if (definition.id === 0) height = 1.52;
  if (definition.id === 59) height = 1.75;
  if (definition.id === 31 || definition.id === 14) height = main.min[1] - .025;
  const room: Room = { depth: Math.max(.7, depth * .84), height,
    width: Math.max(.9, width * .88), x: centre[0], z: door.z - Math.max(.7, depth * .84) / 2 - .1 };
  if (definition.id === 31) { room.depth = Math.min(room.depth, .92); room.z = door.z - room.depth / 2 - .16; }
  if (definition.id === 14) {
    room.width = .98; room.depth = .68; room.x = 0; room.z = -.035;
    const cut = original.balconyDoor!.position[1] - .06;
    addRoom(context, room, 0, cut, door.top + .1);
    addRoom(context, room, cut, height - cut, original.balconyDoor!.position[1] + original.balconyDoor!.height);
    for (const x of [-.33, .33]) context.add({ position: [x, .43, .275], shape: "bevel-box",
      size: [.13, .86, .30], stage: 2, surface: "plaster" });
    context.add({ position: [0, .91, .275], shape: "bevel-box", size: [.79, .12, .30],
      stage: 2, surface: "plaster" });
    const balcony = original.balconyDoor!;
    for (const x of [-.275, .275]) context.add({ position: [x, balcony.position[1] + balcony.height / 2, .345],
      shape: "bevel-box", size: [.10, balcony.height + .04, .24], stage: 2, surface: "plaster" });
    context.add({ position: [0, balcony.position[1] + balcony.height + .04, .345], shape: "bevel-box",
      size: [.65, .12, .24], stage: 2, surface: "plaster" });
  } else if (definition.id === 31) {
    // A broad chamber steps inward to a slim rounded windshaft housing, behind the sail plane.
    const lower = { ...room, width: Math.min(room.width * 1.22, context.limit.extentX * 1.8) };
    addRoom(context, lower, 0, 1.16, door.top + .13);
    room.width *= .78; room.depth *= .78;
    addRoom(context, room, 1.16, height - 1.16, 0, true);
    context.add({ position: [room.x, 1.165, room.z], shape: "cylinder",
      size: [lower.width * 1.025, .07, lower.depth * 1.025], stage: 2, surface: "plaster" });
    context.add({ position: [room.x, 1.82, room.z + room.depth / 2 + .008], shape: "box",
      size: [.12, .24, .018], stage: 2, surface: "dark" });
  } else addRoom(context, room, 0, height, door.top + .13);
  const domed = DOMED_OCCUPATIONS.has(definition.id) || definition.id === 14 || definition.id === 31;
  if (domed) {
    context.add({ position: [room.x, height + .035, room.z], radialSegments: context.detailed ? 32 : 12,
      shape: "cylinder", size: [room.width * .96, .07, room.depth * .96], stage: 3, surface: "plaster" });
    context.add({ position: [room.x, height + .07, room.z], shape: "dome",
      size: [room.width, Math.min(1.4, room.width * .9), room.depth], stage: 3, surface: "roof" });
  } else {
    // Smaller workshops have convex barrel roofs over their curved outer walls.
    const rise = Math.min(.8, room.width * .5);
    addPersianVaultCap(context.add, room.x, room.z, room.width, room.depth, height, rise, 1, false, context.detailed);
    context.add({ occupationRoof: "barrel", position: [room.x, height + rise * .44, room.z],
      radialSegments: context.detailed ? 16 : 6, shape: "occupation-roof", size: [room.width, rise, room.depth], stage: 3, surface: "roof" });
  }
  addIwan(context, body, room, definition);
  addRoundWindows(context, room);
  // The fisher's two equipment shelves become a free-standing drying rack rather than
  // floating brackets on the former rectangular back wall.
  if (definition.id === 18) {
    const shelves = original.parts.filter(part => !part.stock && part.surface === "wood" &&
      part.shape === "box" && part.size[0] > 1 && part.size[1] < .04 && part.position[2] < -.5);
    const shelf = shelves[0];
    if (shelf) for (const side of [-1, 1]) context.add({
      position: [shelf.position[0] + side * .45, .46, shelf.position[2] - .04],
      shape: "bevel-box", size: [.045, .92, .045], stage: 3, surface: "wood"
    });
  }
  if (definition.id === 57 && context.detailed) for (const x of [.33, .57]) context.add({
    position: [x, .17, .535], shape: "bevel-box", size: [.04, .34, .05], stage: 3, surface: "wood"
  });
  const used = new Set<RoofEnvelope>([main, ...body.roofs.filter(roof => roof.round)]);
  for (const roof of body.roofs) {
    if (roof.min[2] >= door.z - .02 && door.left > roof.min[0] && door.right < roof.max[0]) used.add(roof);
    const at = envelopeCenter(roof);
    if (at[1] > height && Math.abs(at[0] - room.x) < room.width / 2 &&
      Math.abs(at[2] - room.z) < room.depth / 2) used.add(roof);
  }
  for (const roof of body.roofs) {
    if (used.has(roof)) continue;
    const at = envelopeCenter(roof), span = envelopeSize(roof);
    const walled = body.walls.some(wall => wall.base < .2 &&
      (wall.min[0] + wall.max[0]) / 2 >= roof.min[0] && (wall.min[0] + wall.max[0]) / 2 <= roof.max[0] &&
      (wall.min[2] + wall.max[2]) / 2 >= roof.min[2] && (wall.min[2] + wall.max[2]) / 2 <= roof.max[2]);
    if (!walled) { addPersianVaultSupports(context, roof); continue; }
    if (span.width < .5 || span.depth < .5) continue;
    const wing: Room = { depth: span.depth * .86, height: Math.max(.55, roof.min[1] + .01),
      width: span.width * .88, x: at[0], z: at[2] };
    // A shipyard's actual entrance belongs to its smaller side room, not its main vault.
    addRoom(context, wing, 0, wing.height, door.top + .13, !roomContainsEntrance(door, wing));
    if (![1, 2, 4, 9].includes(definition.id)) {
      const turned = span.width > span.depth, across = turned ? span.depth : span.width;
      const rise = Math.min(Math.max(.25, span.height * .95), across * .57);
      addPersianVaultCap(context.add, wing.x, wing.z, turned ? wing.depth : wing.width,
        turned ? wing.width : wing.depth, roof.min[1], rise,
        (turned ? wing.depth : wing.width) / across, turned, context.detailed);
    }
  }
  return used;
};

/** Old thin panes and window jambs cannot remain floating on the previous rectangular facade. */
export const keepPersianRoundedProp = (part: BuildingPart) => {
  if (part.fireboxMouth) return true;
  if (part.stock) return true;
  if (part.surface === "dark" && part.position[1] > .9 && part.size[1] < .02 &&
    part.size[0] > .07 && part.size[2] > .07) return false;
  if (part.surface === "dark" && Math.min(...part.size) <= .04 && part.size[1] > .12) return false;
  if (["stone", "cut-stone", "plaster"].includes(part.surface) && part.shape === "ring" && part.size[0] < .5)
    return false;
  if (["stone", "cut-stone", "plaster"].includes(part.surface) && part.shape === "box" &&
    part.size[0] <= .055 && part.size[2] <= .055 && part.size[1] < .5) return false;
  return true;
};
