import type { BuildingDefinition } from "./building-catalog";
import type { BuildingPart, BuildingRecipe, Point3 } from "./building-recipe";
import { getRomanRecipeBounds } from "./building-recipe-fit";
import { classifyNationBody, type RoofEnvelope, type WallRun } from "./nation-kit-classify";
import { bodyCenter, type DoorGap, doorGapOf, type KitContext } from "./nation-kit-parts";
import { BIG_RESIDENCE, MEDIUM_RESIDENCE, SMALL_RESIDENCE } from "./roman-residences";

export const RESIDENCE_IDS: readonly number[] = [57, 58, 59];

const WALL = .11;
const ROMAN_WALL_TOP: Readonly<Record<number, number>> = {
  57: SMALL_RESIDENCE.height, 58: MEDIUM_RESIDENCE.height, 59: BIG_RESIDENCE.height
};

/** What a nation residence is built from: the Roman plan's door, plot envelope and the level 3 raise. */
export interface ResidenceSite {
  add: KitContext["add"];
  parts: BuildingPart[];
  detailed: boolean;
  door: DoorGap;
  /** Plane of the front wall's centre (the door leaf stands just in front of it). */
  front: number;
  limit: { extentX: number; extentZ: number };
  /** Ground wall top: the Roman plan's (with its raise), so the level dressing fits these walls too. */
  wallTop: number;
  typeId: number;
}

export const createResidenceSite = (original: BuildingRecipe, definition: BuildingDefinition,
  detailed: boolean): ResidenceSite => {
  const parts: BuildingPart[] = [];
  const tops = classifyNationBody(original).walls.filter(wall => wall.base < .1).map(wall => wall.base + wall.height);
  const wallTop = Math.max(ROMAN_WALL_TOP[definition.id]!, ...tops);
  return { add: part => parts.push({ stage: 1, ...part }), detailed, door: doorGapOf(original),
    front: original.door[2] - .016, limit: getRomanRecipeBounds(definition, original), parts,
    typeId: definition.id, wallTop };
};

const wallRun = (min: Point3, max: Point3): WallRun => {
  const along = max[0] - min[0] >= max[2] - min[2] ? 0 : 2;
  return { along, base: min[1], height: max[1] - min[1], length: max[along]! - min[along]!, max, min };
};

/** A rectangular room's wall runs (outer faces on x0/x1/back, front wall centred on `front`). */
export interface Room { x0: number; x1: number; back: number; front: number; base: number; height: number }

/** Walls of a room; with a door, the front wall is split round the doorway and closed above it. */
export const roomWalls = (room: Room, door?: DoorGap): WallRun[] => {
  const { back, base, front, height, x0, x1 } = room, top = base + height;
  const frontMin = front - WALL / 2, frontMax = front + WALL / 2;
  const walls = [
    wallRun([x0, base, back], [x1, top, back + WALL]),
    wallRun([x0, base, back], [x0 + WALL, top, frontMax]),
    wallRun([x1 - WALL, base, back], [x1, top, frontMax])
  ];
  if (!door) return [...walls, wallRun([x0, base, frontMin], [x1, top, frontMax])];
  return [...walls, wallRun([x0, base, frontMin], [door.left, top, frontMax]),
    wallRun([door.right, base, frontMin], [x1, top, frontMax]),
    wallRun([door.left, door.top, frontMin], [door.right, top, frontMax])];
};

export const roofOver = (min: [number, number], max: [number, number], eave: number, top: number,
  rise?: number): RoofEnvelope => ({ max: [max[0], top, max[1]], min: [min[0], eave, min[1]], rise });

/** Architecture kit context for the residence's own walls (corners, door, envelope). */
export const residenceKit = (site: ResidenceSite, walls: readonly WallRun[]): KitContext => ({
  add: site.add, center: bodyCenter(walls), detailed: site.detailed, door: site.door, lean: false,
  limit: site.limit, tower: false, typeId: site.typeId, walls
});

/** Interior floor (the nation pass turns it into boards or paving). */
export const addRoomFloor = (site: ResidenceSite, room: Room) => site.add({
  position: [(room.x0 + room.x1) / 2, room.base + .012, (room.back + room.front) / 2], shape: "box",
  size: [room.x1 - room.x0 - .15, .024, room.front - room.back - .15], stage: 0, surface: "mosaic" });

/** A window pane in a front wall (facing +z), `out` beyond the wall centre. */
export const frontPane = (site: ResidenceSite, x: number, y: number, size: [number, number]): BuildingPart => ({
  position: [x, y, site.front + WALL / 2 + .006], shape: "window-shadow", size: [size[0], size[1], .02], stage: 3, surface: "dark"
});

export const finishResidence = (original: BuildingRecipe, site: ResidenceSite): BuildingRecipe =>
  ({ ...original, parts: site.parts });
