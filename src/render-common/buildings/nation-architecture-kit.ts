import { DMath } from "../../shared/math/deterministic-math";
import { COMMANDER_LODGE_TYPE_ID } from "../../shared/settlement/building-type-ids";
import type { SettlerNation as WorkerNation } from "../workers/worker-unit";
import type { BuildingDefinition } from "./building-catalog";
import { usesSmallBuildingArchitecture } from "./building-size-tiers";
import type { BuildingPart, BuildingRecipe, BuildingSurface, Point3 } from "./building-recipe";
import { getRomanPartBounds, getRomanRecipeBounds } from "./building-recipe-fit";
import { classifyNationBody, type NationBody } from "./nation-kit-classify";
import { addTimberCornerPost, findQuoinStacks, type QuoinStack } from "./nation-kit-corner-posts";
import { fitBeamUnderJapaneseRoofs, japaneseDoor, japaneseRoof, japaneseWall } from "./nation-kit-japanese";
import { nubianDoor, nubianRoof, nubianWall } from "./nation-kit-nubian";
import { isInCupolaColumn, nubianCupola, type NubianCupolaSite,nubianCupolaSites } from "./nation-kit-nubian-cupola";
import { isTablet, remountNubianSigns, settleNubianParts } from "./nation-kit-nubian-support";
import {
  bodyCenter, doorGapOf, insideRoof, type KitContext,
MASONRY_SURFACES, timberWindowFrame, wallNormal} from "./nation-kit-parts";
import { type PorchSigns,remountPorchSigns } from "./nation-kit-porch-signs";
import { addNationTowers, withoutMilitaryTowers } from "./nation-kit-towers";
import { isPreviousVikingHq, vikingDoor, vikingRoof, vikingWall } from "./nation-kit-viking";

type BuildNation = Exclude<WorkerNation, "roman">;
const LOG_WALL_HEIGHT = 1.4;
/** Logs cost 48 triangles each on High; huts needing more are built stave-style instead. */
const MAX_LOGS = 70;
const LOG_COURSE = .12;
/**
 * Measured with tools/bench/nation-building-budget.ts: on these prop- and mechanism-heavy
 * buildings the full extras pass 9,800 High triangles, so only signature features are added.
 */
const LEAN_BUILDINGS: Readonly<Record<BuildNation, readonly number[]>> = {
  japanese: [0, 23, 25, 27, 39], nubian: [18, 23, 25, 27, 32, 37, 39], viking: []
};

const NUBIAN_TABLET_TINT: BuildingPart["tint"] = [.55, .38, .22];

const ROOF_STRUCTURE = new Set<BuildingSurface>(["stone", "plaster", "cut-stone", "wood", "dark"]);

/** A slender upright round shaft carrying a porch roof (not a round tower or a chimney). */
const PORCH_COLUMN = { maxWidth: .2, minHeight: .5 } as const;
const isPorchColumn = (part: BuildingPart) => part.shape === "cylinder" && !part.rotation && !part.stock &&
  part.size[1] >= PORCH_COLUMN.minHeight && Math.max(part.size[0], part.size[2]) <= PORCH_COLUMN.maxWidth;

/** Masonry trims, steps and chimneys take the nation's own building material. */
const resurface = (part: BuildingPart, nation: BuildNation): BuildingPart => {
  if (part.surface === "paint" && (part.shape === "ring" && part.size[0] > 1 ||
      part.shape === "box" && part.size[0] > .3 && part.position[1] > .8))
    return { ...part, surface: nation === "nubian" ? "plaster" : "wood", tint: undefined };
  if (part.shape === "civic-column-shaft") return { ...part, shape: "cylinder", surface: nation === "nubian" ? "plaster" : "wood" };
  if (!MASONRY_SURFACES.has(part.surface)) return part;
  const low = getRomanPartBounds(part).max[1] < .35;
  // The occupation tablet is a smooth lime-washed panel, not a patch of mud brick.
  if (nation === "nubian" && isTablet(part)) return { ...part, surface: "paint", tint: NUBIAN_TABLET_TINT };
  if (nation === "nubian") return { ...part, surface: "plaster" };
  if (nation === "viking") return { ...part, surface: low ? "stone" : "wood" };
  // Porch columns are timber pillars (hashira), not lime-washed shafts.
  if (isPorchColumn(part)) return { ...part, surface: "wood" };
  if (low) return { ...part, surface: "cut-stone" };
  return { ...part, surface: part.size[1] > .3 ? "plaster" : "wood" };
};

/** Timber-framed windows: frame depth off the wall face (Viking frames also clear the battens). */
const WINDOW_FRAME_DEPTH: Readonly<Record<Exclude<BuildNation, "nubian">, number>> = { japanese: .035, viking: .045 };
/** The dark pane sits this far behind the frame's front, inside the frame. */
const PANE_RECESS = .008;

/** How far a window's centre stands off the wall face: inside its timber frame, or flush in mud brick. */
const windowStandoff = (part: BuildingPart, nation: BuildNation, axis: number) => {
  if (nation === "nubian") return part.size[axis]! / 2 + .002;
  return WINDOW_FRAME_DEPTH[nation] - PANE_RECESS - part.size[axis]! / 2;
};

/** Roman window jambs (addRomanSideWindows): timber nations replace them with a full window frame. */
const WINDOW_JAMB_SIZE: Point3 = [.045, .37, .045];
const isWindowJamb = (part: BuildingPart) => part.shape === "box" && MASONRY_SURFACES.has(part.surface) &&
  part.size.every((value, axis) => Math.abs(value - WINDOW_JAMB_SIZE[axis]!) < .002);

/** Windows sit on the outer face, never past the original plot line; timber nations frame them. */
const pushWindow = (part: BuildingPart, context: KitContext, body: NationBody, nation: BuildNation,
  limit: { extentX: number; extentZ: number }): BuildingPart => {
  if (part.surface !== "dark" || Math.min(...part.size) > .05) return part;
  for (const wall of body.walls) {
    const normal = wallNormal(wall, context.center), plane = (wall.min[normal.axis]! + wall.max[normal.axis]!) / 2;
    if (Math.abs(part.position[normal.axis]! - plane) > .1) continue;
    if (part.position[wall.along]! < wall.min[wall.along]! || part.position[wall.along]! > wall.max[wall.along]!) continue;
    // Mud brick: an upper-storey window belongs to the wall it is set in, not a lower wing's wall.
    if (nation === "nubian" && (part.position[1] < wall.min[1] || part.position[1] > wall.max[1])) continue;
    const position = [...part.position] as BuildingPart["position"], face = plane + normal.sign * normal.thickness / 2;
    position[normal.axis] = face + normal.sign * windowStandoff(part, nation, normal.axis);
    const extent = normal.axis === 0 ? limit.extentX : limit.extentZ;
    if (Math.abs(position[normal.axis]!) + part.size[normal.axis]! / 2 > extent) return part;
    const pane = { ...part, position };
    if (nation !== "nubian") timberWindowFrame(context.add, pane, wall.along, face,
      normal.sign * WINDOW_FRAME_DEPTH[nation]);
    return pane;
  }
  return part;
};

/**
 * Occupation tablets leave the replaced Roman gables: Nubian ones move to the parapet, timber
 * nations hang them on the porch beam. Nubian raised cupolas lose their Roman colonnade.
 */
interface NationRebuild extends PorchSigns {
  cupolas: readonly NubianCupolaSite[];
  /** Japanese hip roofs carry their own rim: the Roman eave courses along the old roofs go. */
  eaveCourses: boolean;
  flatRoofs: boolean;
}

const nationRebuild = (body: NationBody, nation: BuildNation): NationRebuild =>
  nation === "nubian"
    ? { cupolas: nubianCupolaSites(body), dropped: new Set(), eaveCourses: false, flatRoofs: true,
      signs: remountNubianSigns(body.keep, body.roofs) }
    : { cupolas: [], eaveCourses: nation === "japanese", flatRoofs: false,
      ...remountPorchSigns(body.keep, body.roofs) };

/** Thin Roman course along a roof's eave or gable edge (at most this tall, this far outside it). */
const EAVE_COURSE_HEIGHT = .06;
const EAVE_COURSE_REACH = .03;
const isEaveCourse = (part: BuildingPart, bounds: ReturnType<typeof getRomanPartBounds>,
  roofs: NationBody["roofs"]) =>
  part.stage === 4 && part.shape === "box" && MASONRY_SURFACES.has(part.surface) &&
  part.size[1] <= EAVE_COURSE_HEIGHT && roofs.some(roof => bounds.max[1] >= roof.min[1] &&
    bounds.min[1] <= roof.max[1] && [0, 2].every(axis => bounds.min[axis]! >= roof.min[axis]! - EAVE_COURSE_REACH &&
      bounds.max[axis]! <= roof.max[axis]! + EAVE_COURSE_REACH));

const isKept = (part: BuildingPart, body: NationBody, rebuild: NationRebuild) => {
  if (part.stock || rebuild.signs.has(part)) return true;
  if (rebuild.dropped.has(part)) return false;
  // Gable cornices, roof courses and the statue plinth belong to the replaced Roman roofs.
  if (rebuild.flatRoofs && part.stage === 4 && MASONRY_SURFACES.has(part.surface)) return false;
  const bounds = getRomanPartBounds(part);
  if (rebuild.eaveCourses && isEaveCourse(part, bounds, body.roofs)) return false;
  if (isInCupolaColumn(part, bounds, rebuild.cupolas)) return false;
  return !ROOF_STRUCTURE.has(part.surface) || !insideRoof(part, body.roofs, bounds);
};

const keptParts = (body: NationBody, nation: BuildNation, context: KitContext,
  limit: { extentX: number; extentZ: number }, rebuild: NationRebuild,
  replaced: ReadonlySet<BuildingPart>) => body.keep
  .filter(part => !replaced.has(part) && isKept(part, body, rebuild) &&
    (nation === "nubian" || !isWindowJamb(part)))
  .map(part => part.stock ? part
    : pushWindow(resurface(rebuild.signs.get(part) ?? part, nation), context, body, nation, limit));

/** Timber nations build a corner post where Roman quoins were stacked (mud brick keeps them). */
const quoinStacksOf = (body: NationBody, nation: BuildNation, context: KitContext) =>
  nation === "nubian" ? [] : findQuoinStacks(body.keep, context.center, body.walls);

/** A porch column this close (plan) to a wall corner already marks it: no second post beside it. */
const PORCH_COLUMN_CORNER_REACH = .35;
const hasPorchColumn = (stack: QuoinStack, columns: readonly BuildingPart[]) => columns.some(column =>
  DMath.hypot(column.position[0] - stack.corner[0], column.position[2] - stack.corner[2]) < PORCH_COLUMN_CORNER_REACH);

const addCornerPosts = (stacks: readonly QuoinStack[], body: NationBody, nation: Exclude<BuildNation, "nubian">,
  context: KitContext, rebuild: NationRebuild) => {
  const columns = body.keep.filter(isPorchColumn);
  for (const stack of stacks) {
    if (hasPorchColumn(stack, columns)) continue;
    addTimberCornerPost(context, nation, stack, stack.blocks.filter(block => isKept(block, body, rebuild)));
  }
};

const NUDGE_LIMIT = .06;

/** Moves a part inward by its overrun on one axis; null when it overruns by more than the nudge limit. */
const nudgeAxis = (part: BuildingPart, axis: 0 | 2, extent: number) => {
  const { max, min } = getRomanPartBounds(part);
  const overrun = Math.max(max[axis]! - extent, -extent - min[axis]!);
  if (overrun <= 0) return part;
  if (overrun > NUDGE_LIMIT) return null;
  const position = [...part.position] as BuildingPart["position"];
  position[axis] += max[axis]! > extent ? -overrun : overrun;
  return { ...part, position };
};

/** Added architecture stays inside the original plot envelope: nudged in, or a stray detail left out. */
const withinEnvelope = (added: BuildingPart[], limit: { extentX: number; extentZ: number }) => added.flatMap(part => {
  const inX = nudgeAxis(part, 0, limit.extentX), inside = inX && nudgeAxis(inX, 2, limit.extentZ);
  if (inside) return [inside];
  return part.stage >= 2 && part.stage <= 3 ? [] : [part];
});

const largestRoof = (body: NationBody) => body.roofs.reduce<NationBody["roofs"][number] | undefined>((best, roof) =>
  !best || (roof.max[0] - roof.min[0]) * (roof.max[2] - roof.min[2]) > (best.max[0] - best.min[0]) * (best.max[2] - best.min[2])
    ? roof : best, undefined);

const buildArchitecture = (body: NationBody, nation: BuildNation, context: KitContext, logBuilt: boolean,
  cupolas: readonly NubianCupolaSite[]) => {
  const main = largestRoof(body);
  for (const wall of body.walls) {
    if (nation === "viking") vikingWall(context, wall, logBuilt);
    else if (nation === "japanese") japaneseWall(context, wall);
    else nubianWall(context, wall);
  }
  for (const roof of body.roofs) {
    // The previous Viking HQ (rollback) has turned finials, no gable dragons.
    if (nation === "viking") vikingRoof(context, roof, roof === main && !isPreviousVikingHq(context.typeId),
      isPreviousVikingHq(context.typeId));
    else if (nation === "japanese") japaneseRoof(context, roof, roof === main);
    else if (!roof.round) nubianRoof(context, roof, roof === main, cupolas.some(site => site.deck === roof));
  }
  for (const site of cupolas) nubianCupola(context, site);
  if (!body.walls.length) return;
  if (nation === "viking") vikingDoor(context);
  else if (nation === "japanese") japaneseDoor(context);
  else nubianDoor(context);
};

/**
 * Nation architecture on the Roman plan: walls, door surround and roofs are rebuilt in each
 * nation's construction; plot, envelope, door, stock and work anchors stay exactly as authored.
 */
export const createNationKitRecipe = (
  original: BuildingRecipe, definition: BuildingDefinition, nation: BuildNation, detailed: boolean
): BuildingRecipe => {
  const body = classifyNationBody(withoutMilitaryTowers(original, definition.id)), parts: BuildingPart[] = [];
  const added: BuildingPart[] = [], limit = getRomanRecipeBounds(definition, original);
  const context: KitContext = { add: part => added.push({ stage: 1, ...part }), center: bodyCenter(body.walls),
    detailed, door: doorGapOf(original), lean: LEAN_BUILDINGS[nation].includes(definition.id), limit,
    tower: definition.style === "tower", typeId: definition.id, walls: body.walls };
  const rebuild = nationRebuild(body, nation), quoins = quoinStacksOf(body, nation, context);
  const kept = keptParts(body, nation, context, limit, rebuild, new Set(quoins.flatMap(stack => stack.blocks)));
  parts.push(...nation === "japanese" ? kept.map(part => fitBeamUnderJapaneseRoofs(part, body.roofs, detailed)) : kept);
  const doorSurface = nation === "nubian" ? "plaster" : "wood";
  parts.push(...body.doorSurround.map(part => ({ ...part, surface: doorSurface }) as BuildingPart));
  const logs = body.walls.reduce((sum, wall) => sum + Math.ceil(wall.height / LOG_COURSE), 0);
  // The Commander's Lodge is a stave-built hall rather than a notched log hut: its larger footprint
  // and yard would exceed the shared minimal budget as a full log stack.
  const logBuilt = definition.id !== COMMANDER_LODGE_TYPE_ID &&
    usesSmallBuildingArchitecture(definition.id) && logs <= MAX_LOGS &&
    body.walls.every(wall => wall.base + wall.height <= LOG_WALL_HEIGHT);
  buildArchitecture(body, nation, context, logBuilt, rebuild.cupolas);
  if (nation !== "nubian") addCornerPosts(quoins, body, nation, context, rebuild);
  const towers = addNationTowers(original, context, nation);
  parts.push(...withinEnvelope(added, limit), ...towers);
  return { ...original, parts: nation === "nubian" ? settleNubianParts(parts) : parts };
};
