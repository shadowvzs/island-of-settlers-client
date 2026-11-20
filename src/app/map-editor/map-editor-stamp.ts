import type { EditRefusal } from "../../shared/world/editing/edit-refusal";
import { TERRAIN_BRUSH_MODES } from "../../shared/world/editing/terrain/terrain-brush";
import { getCircleRegion, sampleSmooth } from "../../shared/world/grid-geometry";
import type { WorldData } from "../../shared/world/world-data";
import type { DecorationEditor } from "./decoration-editor";
import type { DecorationPaletteEditor } from "./decoration-palette-editor";
import { applyEditorTool, type EditContext } from "./editor-apply";
import type { EditorHistory } from "./editor-history";
import type { GroundPoint, StampPress } from "./editor-input";
import type { EditRefresher } from "./editor-refresh";
import { type EditorStore, type EditorTool, getToolSettings } from "./editor-store";
import type { MarbleEditor } from "./marble-editor";
import { MAP_EDITOR_MESSAGES as M } from "./messages";
import type { RiverEditor } from "./river-editor";
import type { ScenarioEditor } from "./scenario-editor";
import type { ScenarioRoadEditor } from "./scenario-road-editor";
import type { ScriptWindow } from "./script/script-window";
import { getStampKind } from "./terrain-stroke";
import type { TerrainTool } from "./terrain-tool";

/**
 * Rows/cells beyond a brush stamp checked for dependent history layers (build class clearance,
 * crown shade, mine zone reach). The actual edit cells are recorded by the tool as well.
 */
const HISTORY_HALO = 16;

/** The bounds a placement/brush tool can touch before its exact outcome is known. */
const toolHistoryScope = (world: WorldData, point: GroundPoint, brushSize: number) => ({
  cells: getCircleRegion(world, point.x, point.z, brushSize + HISTORY_HALO),
  waterChanged: false
});

/** A reset ground stamp waiting for the terrain batch that removes its stamps. */
interface PendingReset {
  brushSize: number;
  point: GroundPoint;
}

export interface EditorStampHandlerOptions {
  /** The current edit context (ground, seeds, placement) of the editor. */
  applyContext: () => EditContext;
  decorationEditor: DecorationEditor;
  decorationPalette: DecorationPaletteEditor;
  history: EditorHistory;
  marbleEditor: MarbleEditor;
  onEdit: () => boolean;
  onPropsRemoved: (ids: readonly number[]) => void;
  onTreesPlaced: (ids: readonly number[]) => void;
  refresher: EditRefresher;
  riverEditor: RiverEditor;
  scenarioEditor: ScenarioEditor;
  scenarioRoads: ScenarioRoadEditor;
  scriptWindow: ScriptWindow;
  showRefusal: (refusal: EditRefusal | null) => void;
  store: EditorStore;
  terrain: TerrainTool;
  /** Starts a Mountain / Lake stroke (`start` from the terrain stroke controller). */
  terrainStroke: { start: (point: GroundPoint, ctrl: boolean) => void };
  world: WorldData;
}

/**
 * What one tool press does: the immediate tools, the brushes that wait for their terrain batch
 * (Mountain / Lake), and the reset brushes replayed after that batch. The editor's input calls
 * `stamp` for every press and drag point.
 */
export const createEditorStampHandler = (options: EditorStampHandlerOptions) => {
  const { history, store, world } = options;
  const pendingResets: PendingReset[] = [];

  /** Applies a tool at once and queues its rebuild. */
  const applyTool = (tool: EditorTool, point: GroundPoint, brushSize: number) => {
    const outcome = applyEditorTool(
      { ...options.applyContext(), ...getToolSettings(store.getState(), tool.kind) },
      tool, point, brushSize
    );
    options.showRefusal(outcome.refusal);
    if (!outcome.refusal || outcome.notice) store.setHint(outcome.notice, outcome.refusal !== null);
    options.refresher.queue(outcome);
    history.note(outcome);
    if (outcome.placed.length > 0) options.onTreesPlaced(outcome.placed);
    if (outcome.removed.length > 0) options.onPropsRemoved(outcome.removed);
  };

  /**
   * After a terrain batch the reset brushes paint their meadow again (the batch derived the
   * ground of the removed stamps from the original ground).
   */
  const replayResets = () => {
    const resets = pendingResets.splice(0);
    const tool = { kind: "resetGround" as const, value: 0 };
    for (const { brushSize, point } of resets) applyTool(tool, point, brushSize);
    options.refresher.finishStroke();
  };

  /** A cancelled terrain batch drops its pending reset stamps. */
  const discardPendingResets = () => {
    pendingResets.length = 0;
    history.settle();
  };

  const stamp = (point: GroundPoint, press: StampPress) => {
    const { brushSize, tool } = store.getState();
    if (!tool) return;
    if (tool.kind === "scenarioRoad") {
      if (press.first) options.scenarioRoads.stamp(point);
      return;
    }
    if (tool.kind === "decoration") {
      if (press.first) options.decorationEditor.stamp(point);
      return;
    }
    if (tool.kind === "decorationPalette") {
      if (press.first) options.decorationPalette.stamp(point);
      return;
    }
    if (tool.kind === "marble") {
      if (press.first) options.marbleEditor.stamp(point);
      return;
    }
    if (tool.kind === "river") {
      options.riverEditor.stamp(point, press.first);
      return;
    }
    if (tool.kind === "scenario") {
      if (press.first) options.scenarioEditor.stamp(point);
      return;
    }
    if (tool.kind === "scriptPick") {
      if (press.first) options.scriptWindow.workspace.pickAt(point);
      return;
    }
    if (tool.kind === "terrain" && tool.value === 7) {
      store.setTargetHeight(sampleSmooth(world, world.heights, point.x, point.z) - world.seaLevel);
      store.toggleTool("terrain", 6);
      store.setHint(M.hints.heightPicked);
      return;
    }
    if (!options.onEdit()) return;
    if (tool.kind === "terrain" || tool.kind === "resetGround") {
      // The terrain stamps change before the queued batch (or the reset paint) reaches the
      // world: keep their pre-edit state now, capture the world layers just before applying.
      history.begin(undefined, { deferLayers: true });
    } else {
      history.begin(toolHistoryScope(world, point, brushSize));
    }
    if (tool.kind === "terrain") {
      const mode = TERRAIN_BRUSH_MODES[tool.value];
      const { brushStrength, protectCoast, targetHeight } = store.getState();
      if (mode) options.terrain.brushAt(point, brushSize, mode, {
        strength: brushStrength, targetHeight: world.seaLevel + targetHeight, protectCoast
      });
      return;
    }
    if (getStampKind(tool) !== null) {
      if (press.first) options.terrainStroke.start(point, press.ctrl);
      return;
    }
    if (tool.kind === "resetGround") {
      const resetStamps = options.terrain.resetAt(point, brushSize);
      history.capture(toolHistoryScope(world, point, brushSize));
      if (resetStamps > 0) pendingResets.push({ brushSize, point });
    }
    applyTool(tool, point, brushSize);
  };

  return { discardPendingResets, replayResets, stamp };
};
