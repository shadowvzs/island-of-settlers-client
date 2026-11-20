import type { RoadDecorationItemId } from "../../../../island-of-settlers-shared/src/road-decoration-items";
import type { RoadDecorationGhostFrame } from "../../render-common/renderer-contract";
import {
  createScenarioDecorationLayout, type ScenarioDecorationLayout
} from "../../shared/settlement/scenario-decoration-layout";
import {
  type DecorationEntry, findDecorationEntry, listDecorationEntries, type PlacedDecorationEntry
} from "../../shared/world/editing/decoration-registry";
import {
  isGroundDecorationSpacingClear, isPointSpacingClear
} from "../../shared/world/editing/decoration-spacing";
import { sampleSmooth } from "../../shared/world/grid-geometry";
import type { MapScenario } from "../../shared/world/map-scenario";
import { MAX_SCENARIO_DECORATIONS, type ScenarioDecoration } from "../../shared/world/scenario-decorations";
import { allocateScenarioObjectId } from "../../shared/world/scenario-object-ids";
import type { WorldData } from "../../shared/world/world-data";
import type { DecorationEditor } from "./decoration-editor";
import type { EditorHistory } from "./editor-history";
import type { EditorStore } from "./editor-store";
import { type EditorText, MAP_EDITOR_MESSAGES as M } from "./messages";
import { warnScriptObjectRemoved } from "./script-object-warning";
import { createSectionStore } from "./section-store";

/** Palette tool values: place the selected model, remove the decoration at a click. */
export const PALETTE_MODE = { place: 0, remove: 1 } as const;
/** Click radius that finds a placed decoration model to remove (world units). */
const REMOVE_RADIUS = 1.5;
const NO_FRAMES: ReturnType<ScenarioDecorationLayout["frames"]> = [];

const REFUSALS: Readonly<Record<string, EditorText>> = {
  "decoration-obstructed": M.palette.refusal.obstructed,
  "decoration-spacing": M.palette.refusal.spacing,
  "road-traffic-obstructed": M.palette.refusal.roadTraffic,
  "uneven-support-ground": M.palette.refusal.uneven
};
const refusalMessage = (reason: string) => REFUSALS[reason] ?? M.palette.refusal.ground;

const toRadians = (degrees: number) => (((degrees % 360) + 360) % 360) * Math.PI / 180;

/** The nearest authored decoration model within the remove radius, or -1. */
const findScenarioDecoration = (scenario: MapScenario | undefined, point: { x: number; z: number }) => {
  let found = -1;
  let best = REMOVE_RADIUS * REMOVE_RADIUS;
  (scenario?.decorations ?? []).forEach((decoration, index) => {
    const distance = (decoration.x - point.x) ** 2 + (decoration.z - point.z) ** 2;
    if (distance > best) return;
    found = index;
    best = distance;
  });
  return found;
};

const firstEntry = listDecorationEntries()[0]!;
const defaultVariant = (entry: DecorationEntry) => (entry.source === "placed" ? entry.items[0]! : "");

/**
 * The decoration palette: one single-select list of every registered decoration. Natural props go
 * through the ground decoration editor (world props); decoration models are authored scenario rows
 * measured with the game's own decoration placement rules. Both share the editor's undo history.
 */
export const createDecorationPaletteEditor = (world: WorldData, store: EditorStore, history: EditorHistory,
  ground: DecorationEditor, onEdit: () => boolean | void) => {
  const section = createSectionStore({
    blocked: 0, category: "", mode: -1, placed: 0, rotation: "0", scale: "1", search: "",
    selected: firstEntry.id, variant: defaultVariant(firstEntry)
  });
  let layout: ScenarioDecorationLayout | undefined;
  let layoutKey = "";
  let layoutScenario = world.scenario;
  let revision = 0;
  const getLayout = () => {
    const key = `${revision}:${world.buildRevision ?? 0}:${world.terrainRevision ?? 0}`;
    if (!layout || key !== layoutKey || layoutScenario !== world.scenario) {
      layout = createScenarioDecorationLayout(world);
      layoutKey = key;
      layoutScenario = world.scenario;
    }
    return layout;
  };
  const refreshCounts = () => {
    const placed = world.scenario?.decorations?.length ?? 0;
    section.update({ blocked: placed ? getLayout().blocked().length : 0, placed });
  };
  const selectedEntry = () => findDecorationEntry(section.get().selected) ?? firstEntry;
  const selectedItem = (entry: PlacedDecorationEntry) => {
    const variant = section.get().variant as RoadDecorationItemId;
    return entry.items.includes(variant) ? variant : entry.items[0]!;
  };
  const rotation = () => toRadians(section.valueAsNumber("rotation") || 0);
  const syncMode = () => {
    const tool = store.getState().tool;
    section.update({ mode: tool?.kind === "decorationPalette" ? tool.value : -1 });
  };
  store.subscribe(syncMode);
  history.subscribe(() => { revision++; refreshCounts(); });
  refreshCounts();

  const writeDecorations = (scenario: MapScenario, decorations: MapScenario["decorations"]) => {
    if (onEdit() === false) return;
    history.transaction(() => { world.scenario = { ...scenario, decorations }; });
  };
  /** Adds a model row with a new map-file id (never a deleted row's id); false when the id space is full. */
  const addDecoration = (scenario: MapScenario, row: Omit<ScenarioDecoration, "id">) => {
    const next = { ...scenario };
    const id = allocateScenarioObjectId(next);
    if (id === null) return false;
    writeDecorations(next, [...scenario.decorations ?? [], { id, ...row }]);
    return true;
  };
  const placeModel = (entry: PlacedDecorationEntry, point: { x: number; z: number }) => {
    const scenario = world.scenario;
    if (!scenario) { store.setHint(M.hints.scenarioConfigureFirst, true); return; }
    const decorations = scenario.decorations ?? [];
    if (decorations.length >= MAX_SCENARIO_DECORATIONS) { store.setHint(M.palette.placeLimit, true); return; }
    const item = selectedItem(entry), yaw = rotation();
    const result = getLayout().plan(item, point, yaw);
    if (!result.ok) { store.setHint(refusalMessage(result.reason), true); return; }
    if (!addDecoration(scenario, { item, x: point.x, yaw, z: point.z })) {
      store.setHint(M.palette.placeLimit, true);
      return;
    }
    store.setHint(M.palette.placed);
  };
  const placeAt = (point: { x: number; z: number }) => {
    const entry = selectedEntry();
    if (entry.source === "placed") { placeModel(entry, point); return; }
    if (!section.reportValidity("rotation", "scale")) return;
    if (!isGroundDecorationSpacingClear(world, point) || !isPointSpacingClear(getLayout().centresNear(point), point)) {
      store.setHint(M.palette.refusal.spacing, true);
      return;
    }
    ground.placeAt(point, {
      propKind: entry.propKind, rotation: rotation(), scale: section.valueAsNumber("scale") || 1
    });
  };
  const removeAt = (point: { x: number; z: number }) => {
    const scenario = world.scenario;
    const index = findScenarioDecoration(scenario, point);
    if (scenario && index >= 0) {
      const objectId = scenario.decorations![index]!.id;
      writeDecorations(scenario, scenario.decorations!.filter((_, row) => row !== index));
      store.setHint(M.palette.removed);
      warnScriptObjectRemoved(world, store, objectId);
      return;
    }
    if (ground.removeAt(point)) { store.setHint(M.palette.removed); return; }
    store.setHint(M.palette.removeNothing, true);
  };
  /** The selected model's renderer ghost at the hover point while placing a decoration model. */
  let ghost: RoadDecorationGhostFrame | null = null;
  let ghostKey = "";
  const getGhost = (hover: { x: number; z: number } | null) => {
    const entry = selectedEntry();
    if (!hover || section.get().mode !== PALETTE_MODE.place || entry.source !== "placed") return null;
    const item = selectedItem(entry), yaw = rotation();
    const key = `${item}:${hover.x.toFixed(2)}:${hover.z.toFixed(2)}:${yaw}:${layoutKey}:${revision}`;
    if (key === ghostKey && ghost) return ghost;
    const result = getLayout().plan(item, hover, yaw);
    const position = result.ok ? result.position :
      [hover.x, sampleSmooth(world, world.heights, hover.x, hover.z), hover.z] as const;
    ghost = { item, position, valid: result.ok, yaw };
    ghostKey = key;
    return ghost;
  };
  return {
    /** Placed decoration models for the renderer (only rows the placement rules accept). */
    frames: () => (world.scenario?.decorations?.length ? getLayout().frames() : NO_FRAMES),
    getGhost,
    section,
    /** Picks a palette entry and its place tool (picking the active entry again puts the tool away). */
    select: (id: string) => {
      const entry = findDecorationEntry(id);
      if (!entry) return;
      const reselect = section.get().selected === id && section.get().mode === PALETTE_MODE.place;
      const scale = entry.source === "ground" ? String(Math.min(entry.scale.max, Math.max(entry.scale.min,
        section.valueAsNumber("scale") || 1))) : section.get().scale;
      const variant = section.get().selected === id ? section.get().variant : defaultVariant(entry);
      section.update({ scale, selected: id, variant });
      if (reselect) { store.clearTool(); return; }
      store.selectTool("decorationPalette", PALETTE_MODE.place);
    },
    setCategory: (category: string) => section.update({ category }),
    setSearch: (search: string) => section.update({ search }),
    startPlacing: () => store.selectTool("decorationPalette", PALETTE_MODE.place),
    startRemoving: () => store.toggleTool("decorationPalette", PALETTE_MODE.remove),
    stamp: (point: { x: number; z: number }) => {
      if (section.get().mode === PALETTE_MODE.remove) removeAt(point);
      else placeAt(point);
    }
  };
};

export type DecorationPaletteEditor = ReturnType<typeof createDecorationPaletteEditor>;
