import { ZONE_REACH } from "../../render-common/mine-field";
import { clearCoverPaintRegion, paintCoverCells } from "../../render-common/props/cover-paint";
import { createFieldCoverContext, getCoverAcceptance } from "../../render-common/props/field-cover";
import { getSpecies, SPECIES_COUNT } from "../../render-common/wildlife/wildlife-species";
import { TREE_GROWTH_SECONDS } from "../../shared/balance/economy";
import { DEFAULT_AUTHORED_ANIMAL_AGE, MAX_ANIMAL_STAMP_POPULATION } from "../../shared/world/authored-animals";
import { paintBiome } from "../../shared/world/editing/biome-paint";
import type { Brush } from "../../shared/world/editing/brush";
import { type EditGround,refreshBuildLayers } from "../../shared/world/editing/build-refresh";
import type { EditRefusal } from "../../shared/world/editing/edit-refusal";
import { paintGround } from "../../shared/world/editing/ground-paint";
import { eraseMineLand, stampOreDeposit } from "../../shared/world/editing/mine-land";
import { placeProp } from "../../shared/world/editing/prop-placement";
import {
  clearPaintedProps,
  removePropsInBrush,
  STONE_PROPS,
  TREE_PROPS
} from "../../shared/world/editing/prop-removal";
import { createPlantedTreeSpecies } from "../../shared/world/editing/tree-planting";
import {
  type CellRegion,
  EMPTY_REGION,
  expandRegion,
  forEachRegionCell,
  getCircleRegion,
  isRegionEmpty,
  unionRegions} from "../../shared/world/grid-geometry";
import { GREEN_GROUNDS } from "../../shared/world/ground-buffer";
import { getGroundVariantOfTile } from "../../shared/world/ground-variants";
import { MATERIAL, type Ore, PROP, type WorldData } from "../../shared/world/world-data";
import type { EditorTool, EditorToolKind } from "./editor-store";
import { editorMessage, type EditorText, MAP_EDITOR_MESSAGES as M } from "./messages";

/** Soft edge share of the brush and how far one stamp moves the ground to the material. */
const BRUSH_SOFTNESS = 0.55;
const GROUND_STRENGTH = 0.65;
/** Editor deposits stay hidden like generated ore: the hint line confirms the stamp. */
const ORE_PLACED_NOTICE = M.hints.orePlaced;
const QUARRY_STONE_NOTICE = M.hints.quarryStonePlaced;
/** Cells a tree's crown shades around its trunk (the ground's canopy shade follows it). */
const CROWN_REACH = 3;
/** Smallest field-cover acceptance a brush cell needs before painted grass may grow there. */
const MIN_PAINTED_COVER_ACCEPTANCE = 0.01;

/** What an edit needs besides the world. */
export interface EditContext {
  ground: EditGround;
  /** First editor-placed prop; used for redraws and Reset, while erasers also remove generated props. */
  firstPlacedProp: number;
  /** Places an animal at its initial age; false when habitat/body/slot requirements fail. */
  placeAnimal: (species: number, x: number, z: number, age?: number) => boolean;
  /** Stable seed of the next placed tree. */
  nextSeed: () => number;
  world: WorldData;
  treeAge?: number;
  hardwoodForm?: number;
  animalAge?: number;
  animalPopulation?: number;
  brushStrength?: number;
}

/** What an edit changed, for the renderers' rebuild (or why it was refused). */
export interface EditOutcome {
  /** Cells whose rendered ground changed (splat, ore, canopy shade). */
  cells: CellRegion;
  /** The ground material changed (the field cover regrows after the stroke). */
  ground: boolean;
  /** Mine land or ore changed: the mine stones of the cells' chunks are rebuilt. */
  mineStones: boolean;
  /** World props the edit placed (trees: felling and growth adopt them). */
  placed: number[];
  /** The placed props changed. */
  props: boolean;
  /** A notice for the hint line when the edit worked (empty when none). */
  notice: EditorText;
  refusal: EditRefusal | null;
  /** World props the edit removed (painted over, erased): no longer drawn. */
  removed: number[];
  /** Where removed meadow rocks stood: their stones are rebuilt. */
  stoneCells: CellRegion;
}

const NOTHING: EditOutcome = {
  cells: EMPTY_REGION,
  ground: false,
  mineStones: false,
  notice: "",
  placed: [],
  props: false,
  refusal: null,
  removed: [],
  stoneCells: EMPTY_REGION
};

const refuse = (refusal: EditRefusal): EditOutcome => ({ ...NOTHING, refusal });

const paintGroundTool = (context: EditContext, brush: Brush, material: number): EditOutcome => {
  const { world } = context;
  const paint = paintGround(world, { ...brush, material, strength: GROUND_STRENGTH });
  // Variants are an overlay of the ground below: they keep its props like the green grounds.
  const keepsProps = GREEN_GROUNDS.includes(material) || getGroundVariantOfTile(material) >= 0;
  const clearing = keepsProps ? null : clearPaintedProps(world, brush);
  refreshBuildLayers(world, context.ground, paint.cells);
  const mineStones = !isRegionEmpty(paint.mineCells);
  const cells = mineStones ? expandRegion(world, paint.cells, ZONE_REACH) : paint.cells;
  const removed = clearing?.removed ?? [];
  const props = removed.some((index) => index >= context.firstPlacedProp);
  const stoneCells = clearing?.stoneCells ?? EMPTY_REGION;
  return { ...NOTHING, cells, ground: true, mineStones, props, removed, stoneCells };
};

const stampOreTool = (context: EditContext, brush: Brush, ore: Ore): EditOutcome => {
  const stamp = stampOreDeposit(context.world, brush, ore);
  if (typeof stamp === "string") return refuse(stamp);
  return {
    ...NOTHING,
    cells: expandRegion(context.world, stamp.cells, ZONE_REACH),
    mineStones: true,
    notice: ORE_PLACED_NOTICE
  };
};

const eraseMineTool = (context: EditContext, brush: Brush): EditOutcome => {
  const erased = eraseMineLand(context.world, brush);
  if (erased.zoneIds.size === 0) return NOTHING;
  refreshBuildLayers(context.world, context.ground, erased.cells);
  return {
    ...NOTHING,
    cells: expandRegion(context.world, erased.cells, ZONE_REACH),
    mineStones: true,
    notice: M.hints.mineErased
  };
};

/** The ground around a changed prop (canopy shade). */
const getCrownRegion = (world: WorldData, x: number, z: number, radius: number) =>
  getCircleRegion(world, x, z, radius + CROWN_REACH);

/** A cell as a region (where a placed stone stands: its meadow stones are built). */
const getCellRegion = (x: number, z: number): CellRegion => {
  const cellX = Math.floor(x);
  const cellZ = Math.floor(z);
  return { maxX: cellX, maxZ: cellZ, minX: cellX, minZ: cellZ };
};

/** Places a tree or a doodad (stone, pebbles) at the brush centre. */
const biomeSpecies = new WeakMap<WorldData, ReturnType<typeof createPlantedTreeSpecies>>();
/** Resolves the prop to place: -1 picks the biome tree species, a sapling grows a broadleaf tree. */
const resolvePlacedKind = (world: WorldData, brush: Brush, requestedKind: number) => {
  if (requestedKind === PROP.sapling) return PROP.broadleafTree;
  if (requestedKind !== -1) return requestedKind;
  if (!biomeSpecies.has(world)) biomeSpecies.set(world, createPlantedTreeSpecies(world));
  return biomeSpecies.get(world)!(brush.x, brush.z);
};
const placePropTool = (context: EditContext, brush: Brush, requestedKind: number): EditOutcome => {
  const { world } = context;
  const kind = resolvePlacedKind(world, brush, requestedKind);
  const age = requestedKind === PROP.sapling ? 0 : context.treeAge ?? TREE_GROWTH_SECONDS;
  const placed = placeProp(world, { ageSeconds: age, kind, hardwoodForm: context.hardwoodForm,
    seed: context.nextSeed(), x: brush.x, z: brush.z });
  if (typeof placed === "string") return refuse(placed);
  if (TREE_PROPS.has(kind)) (world.authoredTreeAges ??= {})[placed] = age;
  const cells = getCrownRegion(world, brush.x, brush.z, 0);
  const stoneCells = STONE_PROPS.has(kind) ? getCellRegion(brush.x, brush.z) : EMPTY_REGION;
  const notice = kind === PROP.largeRock ? QUARRY_STONE_NOTICE : "";
  return { ...NOTHING, cells, notice, placed: [placed], props: true, stoneCells };
};

/** Removes the props that pass `wanted` under the brush (the ground stays). */
const removeTool = (
  context: EditContext,
  brush: Brush,
  wanted: (index: number) => boolean
): EditOutcome => {
  const { world } = context;
  const { removed, stoneCells } = removePropsInBrush(world, brush, wanted);
  if (removed.length === 0) return NOTHING;
  const cells = getCrownRegion(world, brush.x, brush.z, brush.radius);
  const props = removed.some((index) => index >= context.firstPlacedProp);
  return { ...NOTHING, cells, props, removed, stoneCells };
};

/**
 * Resets the brushed ground to plain meadow grass (mine land goes with it) and clears what the
 * editor placed there; the terrain tool takes the mountains and lakes there away.
 */
const resetGroundTool = (context: EditContext, brush: Brush): EditOutcome => {
  const { world } = context;
  const paint = paintGround(world, { ...brush, material: MATERIAL.grass, strength: 1 });
  refreshBuildLayers(world, context.ground, paint.cells);
  const placed = removeTool(context, brush, (index) => index >= context.firstPlacedProp);
  const coverRegion = getCircleRegion(world, brush.x, brush.z, brush.radius);
  clearCoverPaintRegion(world, coverRegion);
  const mineStones = !isRegionEmpty(paint.mineCells);
  const cells = expandRegion(world, unionRegions(paint.cells, unionRegions(placed.cells, coverRegion)), ZONE_REACH);
  return { ...placed, cells, ground: true, mineStones };
};

/** The exact population grid used by placement and native group-clearance preflight. */
export const animalStampPoints = (species: number, population: number, centre: { x: number; z: number }) => {
  const count = Math.max(1, Math.min(MAX_ANIMAL_STAMP_POPULATION, Math.round(population)));
  const profile = getSpecies(species);
  const spacing = 2 * (Math.max(profile.body.front, profile.body.back) + profile.clearance) * 1.2 + .2;
  const columns = Math.ceil(Math.sqrt(count)), rows = Math.ceil(count / columns);
  return Array.from({ length: count }, (_, index) => ({
    x: centre.x + (index % columns - (columns - 1) / 2) * spacing,
    z: centre.z + (Math.floor(index / columns) - (rows - 1) / 2) * spacing
  }));
};
const placeAnimalTool = (context: EditContext, brush: Brush, species: number): EditOutcome => {
  if (!Number.isInteger(species) || species < 0 || species >= SPECIES_COUNT) return refuse("notWalkable");
  const points = animalStampPoints(species, context.animalPopulation ?? 1, brush), count = points.length;
  const age = context.animalAge ?? DEFAULT_AUTHORED_ANIMAL_AGE;
  let placed = 0;
  for (const { x, z } of points) {
    if (context.placeAnimal(species, x, z, age)) placed++;
  }
  if (!placed) return { ...refuse("notWalkable"), notice: M.hints.noRoom };
  return { ...NOTHING, notice: placed === count
    ? editorMessage(M.hints.animalsPlaced, { placed })
    : editorMessage(M.hints.animalsPartial, { count, placed }) };
};

/** Paint acceptance at cell centres; the same field-cover rules decide where grass may grow. */
const coverBrushCells = (world: WorldData, brush: Brush) => {
  const region = getCircleRegion(world, brush.x, brush.z, brush.radius);
  const context = createFieldCoverContext(world, expandRegion(world, region, 1));
  const cells: number[] = [];
  forEachRegionCell(world, region, (cell, cellX, cellZ) => {
    if (getCoverAcceptance(context, cellX + 0.5, cellZ + 0.5) > MIN_PAINTED_COVER_ACCEPTANCE) cells.push(cell);
  });
  return { cells, region };
};

/** Paints a cover kind where grass is allowed (one shared acceptance with the generated cover). */
const paintCoverTool = (context: EditContext, brush: Brush, kind: number): EditOutcome => {
  const { cells, region } = coverBrushCells(context.world, brush);
  const painted = paintCoverCells(context.world, cells, kind);
  if (!painted) return { ...refuse("blocked"), notice: M.hints.coverNone };
  return { ...NOTHING, cells: region, ground: true, notice: M.hints.coverPainted };
};

/** The doodad eraser clears world props and the painted grass under the brush. */
const removePlantTool = (context: EditContext, brush: Brush): EditOutcome => {
  const removed = removeTool(context, brush, () => true);
  const region = getCircleRegion(context.world, brush.x, brush.z, brush.radius);
  if (!clearCoverPaintRegion(context.world, region)) return removed;
  return { ...removed, cells: unionRegions(removed.cells, region), ground: true };
};

/**
 * The tools that act at once; the others change nothing here (the terrain tools apply through the terrain
 * tool, the scenario, road, river, marble and decoration tools through their own editors).
 */
const TOOLS: Partial<Record<EditorToolKind, (context: EditContext, brush: Brush, value: number) => EditOutcome>> = {
  animal: placeAnimalTool,
  biome: (context, brush, theme) => ({ ...NOTHING,
    cells: paintBiome(context.world, brush, theme, context.brushStrength ?? GROUND_STRENGTH),
    ground: true }),
  cover: paintCoverTool,
  eraser: (context, brush) =>
    removeTool(context, brush, (index) => TREE_PROPS.has(context.world.props.types[index]!)),
  ground: paintGroundTool,
  mineRemover: eraseMineTool,
  ore: (context, brush, ore) => stampOreTool(context, brush, ore as Ore),
  plantRemover: removePlantTool,
  resetGround: resetGroundTool,
  stone: placePropTool,
  tree: placePropTool
};

/**
 * Applies the tool once at a ground point (one brush stamp, one prop, one animal): the world
 * data changes through the shared edit operations; the outcome says what to rebuild.
 */
export const applyEditorTool = (
  context: EditContext,
  tool: EditorTool,
  point: { x: number; z: number },
  brushSize: number
): EditOutcome => {
  const brush = { radius: brushSize, softness: BRUSH_SOFTNESS, x: point.x, z: point.z };
  return TOOLS[tool.kind]?.(context, brush, tool.value) ?? NOTHING;
};
