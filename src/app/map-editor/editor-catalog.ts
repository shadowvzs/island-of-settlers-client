import type { MessageDescriptor } from "@lingui/core";
import {
  editorChoice, type EditorPlaceable, editorToolEntries, type TerrainGroundMaterial
} from "@shared/catalog";

import { contentDescriptor } from "../../shared/i18n/content-text";
import type { EditRefusal } from "../../shared/world/editing/edit-refusal";
import { GROUND_VARIANT_IDS, TILLED_SOIL_VARIANT, toGroundVariantTile } from "../../shared/world/ground-variants";
import { nationsTypicalOfGround, nationsTypicalOfVariant } from "../../shared/world/nation-terrain-affinity";
import { MATERIAL } from "../../shared/world/world-data";
import type { EditorToolKind } from "./editor-store";
import { MAP_EDITOR_MESSAGES as M } from "./messages";

/** One choice of a tool list: what it sets, its English source name, message and icon (assets/editor-icons). */
export interface ToolChoice {
  icon: string;
  label: string;
  /** Catalog prop layer: `cover` choices paint field cover instead of placing a world prop. */
  layer?: "adventure" | "cover" | "worldProp";
  message: MessageDescriptor;
  /** Nations whose homeland typically shows this choice (tooltip, NATION-TERRAIN). */
  nations?: readonly string[];
  value: number;
}

/** A tool without choices (relief tools, removers): its kind, English source name, message and icon. */
export interface ToolEntry {
  icon: string;
  kind: EditorToolKind;
  label: string;
  message: MessageDescriptor;
  nations?: readonly string[];
  value?: number;
}

const toIconName = (group: string, label: string) => `${group}-${label.toLowerCase().replaceAll(" ", "-")}`;

/** The editor icon of a ground decoration model (the doodad icons, by its English name). */
export const toGroundDecorationIcon = (name: string) => toIconName("doodad", name);

const choice = (
  group: string, label: string, message: MessageDescriptor, value: number, nations?: readonly string[]
): ToolChoice => ({
  icon: toIconName(group, label),
  label,
  message,
  ...(nations?.length ? { nations } : {}),
  value
});

/** A ground tile choice with the nations whose homeland typically shows that material. */
const groundChoice = (
  label: string, message: MessageDescriptor, value: number, ground: TerrainGroundMaterial
) => choice("tile", label, message, value, nationsTypicalOfGround(ground));

/** A ground variant choice (paint channel index) with the nations its landscape is typical of. */
const variantChoice = (label: string, message: MessageDescriptor, index: number) =>
  choice("tile", label, message, toGroundVariantTile(index), nationsTypicalOfVariant(GROUND_VARIANT_IDS[index]!));

/** Relief tools: raise a mountain, dig a lake, bring the ground back. */
export const RELIEF_TOOLS: readonly ToolEntry[] = [
  { icon: "relief-mountain", kind: "mountain", label: "Mountain", message: M.catalog.tool.mountain },
  { icon: "relief-alpine", kind: "mountain", label: "Alpine mountain", message: M.catalog.tool.alpineMountain,
    value: 1 },
  { icon: "relief-lake", kind: "lake", label: "Lake", message: M.catalog.tool.lake },
  { icon: "relief-reset", kind: "resetGround", label: "Reset ground", message: M.catalog.tool.resetGround }
];

/** Small terrain adjustments, separate from the level-based mountain/lake stamps. */
export const TERRAIN_TOOLS: readonly ToolEntry[] = [
  { icon: "terrain-raise", kind: "terrain", value: 0, label: "Raise ground", message: M.catalog.tool.raiseGround },
  { icon: "terrain-lower", kind: "terrain", value: 1, label: "Lower ground", message: M.catalog.tool.lowerGround },
  { icon: "terrain-smooth", kind: "terrain", value: 2, label: "Smooth ground", message: M.catalog.tool.smoothGround },
  { icon: "terrain-roughen", kind: "terrain", value: 3, label: "Uneven ground", message: M.catalog.tool.unevenGround },
  { icon: "terrain-beach", kind: "terrain", value: 4, label: "Sandy shore", message: M.catalog.tool.sandyShore },
  { icon: "terrain-sea", kind: "terrain", value: 5, label: "Sea", message: M.catalog.tool.sea },
  { icon: "terrain-flatten", kind: "terrain", value: 6, label: "Flatten to target height",
    message: M.catalog.tool.flatten },
  { icon: "terrain-pick-height", kind: "terrain", value: 7, label: "Pick terrain height",
    message: M.catalog.tool.pickHeight }
];

/** The Relief section's Lower toggle (for trackpads and touch screens: no Ctrl needed). */
export const LOWER_TOGGLE: MapAction = {
  icon: "relief-lower",
  label: "Lower: Mountain and Lake clicks take a level back (Ctrl flips it)",
  message: M.catalog.tool.lowerToggle
};

/** Ground tiles the brush paints (every splat material, then the render-only ground variants). */
export const GROUND_CHOICES: readonly ToolChoice[] = [
  groundChoice("Grass", M.catalog.tile.grass, MATERIAL.grass, "grass"),
  groundChoice("Lush grass", M.catalog.tile.lushGrass, MATERIAL.lushGrass, "lushGrass"),
  groundChoice("Forest floor", M.catalog.tile.forestFloor, MATERIAL.forestFloor, "forestFloor"),
  groundChoice("Dirt", M.catalog.tile.dirt, MATERIAL.dirt, "dirt"),
  groundChoice("Sand", M.catalog.tile.sand, MATERIAL.sand, "sand"),
  groundChoice("Rock", M.catalog.tile.rock, MATERIAL.rock, "rock"),
  groundChoice("Snow", M.catalog.tile.snow, MATERIAL.snow, "snow"),
  groundChoice("Gravel", M.catalog.tile.gravel, MATERIAL.gravel, "gravel"),
  choice("tile", "Mine gravel", M.catalog.tile.mineGravel, MATERIAL.mine),
  // Render-only variants over the ground below (GROUND-PALETTE step 2): paint keeps the splat and its props.
  variantChoice("Coarse stones", M.catalog.tile.coarseStones, 0),
  variantChoice("Moss", M.catalog.tile.moss, 1),
  variantChoice("Swamp mud", M.catalog.tile.swampMud, 2),
  variantChoice("Cracked earth", M.catalog.tile.crackedEarth, 3),
  variantChoice("Tilled soil", M.catalog.tile.tilledSoil, TILLED_SOIL_VARIANT)
];

/** Icon name of a catalog asset path (`editor-icons/tree-oak.webp` → `tree-oak`). */
const ICON_NAME = /^editor-icons\/(.+)\.[a-z]+$/;

/** A tool choice of a catalog prop or deposit: its editor label (or name), editor icon and persisted byte. */
const catalogChoice = (entry: EditorPlaceable): ToolChoice => {
  const text = editorChoice(entry)?.label ?? entry.text.name;
  return {
    icon: ICON_NAME.exec(entry.icon?.path ?? "")?.[1] ?? "",
    label: text.en,
    ...("prop" in entry ? { layer: entry.prop.layer } : {}),
    message: contentDescriptor(text),
    value: entry.code!
  };
};

/** Ores of the deposit stamp (mine land only): the catalog's mine zone deposits. */
export const ORE_CHOICES: readonly ToolChoice[] = editorToolEntries("ore").map(catalogChoice);

/** Mine eraser removes deposits under the brush without flattening or repainting the ground. */
export const MINE_REMOVER: ToolEntry = {
  icon: "relief-reset",
  kind: "mineRemover",
  label: "Remove mine zones and ore",
  message: M.catalog.tool.removeMine
};

/** Doodads the editor places: meadow stones, pebble patches and hand-painted field grass. */
export const DOODAD_CHOICES: readonly ToolChoice[] = editorToolEntries("doodad").map(catalogChoice);

/** Cover choices paint the field cover; the other doodads place a world prop (stone, pebbles). */
export const COVER_DOODAD_CHOICES: readonly ToolChoice[] =
  DOODAD_CHOICES.filter(choice => choice.layer === "cover");
export const STONE_DOODAD_CHOICES: readonly ToolChoice[] =
  DOODAD_CHOICES.filter(choice => choice.layer !== "cover");

/** Doodad eraser: clears generated or painted trees, plants and stones under the brush. */
export const PLANT_REMOVER: ToolEntry = {
  icon: "remove-plants",
  kind: "plantRemover",
  label: "Remove objects: trees, plants and stones",
  message: M.catalog.tool.removePlants
};

/** Trees the editor plants. */
export const TREE_CHOICES: readonly ToolChoice[] = editorToolEntries("tree").map(catalogChoice);

/** Removes the trees under the brush (last in the trees section). */
export const TREE_REMOVER: ToolEntry = {
  icon: "remove-tree",
  kind: "eraser",
  label: "Remove tree",
  message: M.catalog.tool.removeTree
};

/** Adult animals the editor places (the catalog's wildlife with an editor choice). */
export const ANIMAL_CHOICES: readonly ToolChoice[] = editorToolEntries("animal").map(catalogChoice);

/** A map action of the Map section: its icon and name (tooltip, aria-label). */
export interface MapAction {
  icon: string;
  label: string;
  message?: MessageDescriptor;
  /** Nations whose homeland typically shows this choice (tooltip suffix, NATION-TERRAIN). */
  nations?: readonly string[];
}

/** The Map section's actions: the map file and the browser's map slots. */
export const MAP_ACTIONS = {
  backToCampaign: { icon: "map-load", label: "Back to the campaign editor", message: M.actions.backToCampaign },
  deleteSlot: { icon: "map-delete", label: "Delete this saved map", message: M.actions.deleteSlot },
  loadFile: { icon: "map-load", label: "Load map file", message: M.actions.loadFile },
  loadSlot: { icon: "map-load", label: "Load this map", message: M.actions.loadSlot },
  newSlot: { icon: "map-slot-new", label: "Save in the browser (new slot)", message: M.actions.newSlot },
  overwriteSlot: { icon: "map-save", label: "Overwrite with the current map", message: M.actions.overwriteSlot },
  publishStarter: { icon: "map-save", label: "Publish as shared starter map", message: M.actions.publishStarter },
  rollbackStarter: { icon: "map-load", label: "Roll back the shared starter to this revision",
    message: M.actions.rollbackStarter },
  saveCampaignMap: { icon: "map-save", label: "Save campaign map", message: M.actions.saveCampaignMap },
  saveFile: { icon: "map-save", label: "Save main world (World01.smap)", message: M.actions.saveFile }
} as const satisfies Record<string, MapAction>;

/** Undo and redo of the editor's edits (top of the panel). */
export const HISTORY_ACTIONS = {
  redo: { icon: "history-redo", label: "Redo (Ctrl+Y / Ctrl+Shift+Z)", message: M.actions.redo },
  undo: { icon: "history-undo", label: "Undo (Ctrl+Z)", message: M.actions.undo }
} as const satisfies Record<string, MapAction>;

/** The panel's categories: id, short caption, accessible name (title) and icon. */
export const EDITOR_TABS = [
  { id: "terrain", label: "Terrain", labelMessage: M.tabs.terrain.label, name: "Relief and water",
    nameMessage: M.tabs.terrain.name, icon: "relief-mountain" },
  { id: "tiles", label: "Tiles", labelMessage: M.tabs.tiles.label, name: "Tiles and biomes",
    nameMessage: M.tabs.tiles.name, icon: "tile-grass" },
  { id: "units", label: "Units", labelMessage: M.tabs.units.label, name: "Units and camps",
    nameMessage: M.tabs.units.name, icon: "" },
  { id: "deposits", label: "Deposits", labelMessage: M.tabs.deposits.label,
    name: "Stone, marble and mine deposits", nameMessage: M.tabs.deposits.name, icon: "ore-granite" },
  { id: "trees", label: "Trees", labelMessage: M.tabs.trees.label, name: "Trees and forestry",
    nameMessage: M.tabs.trees.name, icon: "tree-oak" },
  { id: "animals", label: "Animals", labelMessage: M.tabs.animals.label, name: "Animals and habitats",
    nameMessage: M.tabs.animals.name, icon: "animal-deer" },
  { id: "objects", label: "Objects", labelMessage: M.tabs.objects.label, name: "Plants and decorations",
    nameMessage: M.tabs.objects.name, icon: "doodad-pebbles" },
  { id: "map", label: "Map", labelMessage: M.tabs.map.label, name: "Map, headquarters and scenario",
    nameMessage: M.tabs.map.name, icon: "map-save" },
  { id: "script", label: "Script", labelMessage: M.tabs.script.label, name: "Triggers, actors and templates",
    nameMessage: M.tabs.script.name, icon: "" }
] as const;

export type EditorTabId = typeof EDITOR_TABS[number]["id"];

/** Brush radius levels (cells). */
export const BRUSH_SIZES: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 16, 24];

/** What the hint line says when an edit was refused. */
export const REFUSAL_HINTS: Record<EditRefusal, MessageDescriptor> = M.refusal;
