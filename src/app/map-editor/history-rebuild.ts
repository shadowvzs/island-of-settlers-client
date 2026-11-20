import type { DiffSide } from "../../shared/world/editing/history/history-meta";
import {
  hasLayerChange,
  type PropChanges,
  type WorldDiff
} from "../../shared/world/editing/history/world-diff";
import type { CellRegion } from "../../shared/world/grid-geometry";
import type { HistoryStep } from "./editor-history";
import type { EditRefresher } from "./editor-refresh";
import type { TerrainTool } from "./terrain-tool";

export interface HistoryRebuildOptions {
  /** World props were taken away (felling and growth forget them). */
  onPropsRemoved: (ids: readonly number[]) => void;
  /** World props came back (felling adopts the trees among them, growth grows its own again). */
  onPropsRestored: (ids: readonly number[]) => void;
  onPropsMoved?: (ids: readonly number[]) => void;
  /**
   * The rough ground of the build layers follows restored tiles (a terrain step measures the
   * terrain tool's ground again).
   */
  refreshGround: (cells: CellRegion) => void;
  refresher: EditRefresher;
  terrain: TerrainTool;
}

/** Stamps on the restored side the other side did not have (units in them move out). */
const listReturnedStamps = (diff: WorldDiff | null, side: DiffSide) => {
  if (!diff?.terrain) return [];
  const other: DiffSide = side === "after" ? "before" : "after";
  const known = new Set(diff.terrain[other].stamps);
  return diff.terrain[side].stamps.filter((stamp) => !known.has(stamp));
};

const isWaterChanged = (diff: WorldDiff | null) =>
  hasLayerChange(diff, "waterSurface") || hasLayerChange(diff, "waterDepth");

/**
 * The rebuild of an undone or redone step, through the same paths an edit takes: a step that
 * moved the ground (mountains, lakes, reset ground) goes the terrain way (preview, worker
 * rebuild of terrain, rocks and water, the navigation), the others the batched chunk refresh
 * (ground, mine stones, meadow stones, placed props); then field cover and minimap.
 */
export const createHistoryRebuild =
  (options: HistoryRebuildOptions) => (step: HistoryStep, side: DiffSide, props: PropChanges) => {
    const { refresher, terrain } = options;
    const { area, diff } = step;
    const restored = new Set(props.restored);
    const moved = options.onPropsMoved ? props.removed.filter(id => restored.has(id)) : [];
    const stable = new Set(moved);
    const removedIds = props.removed.filter(id => !stable.has(id));
    const restoredIds = props.restored.filter(id => !stable.has(id));
    if (removedIds.length) options.onPropsRemoved(removedIds);
    if (restoredIds.length) options.onPropsRestored(restoredIds);
    if (moved.length) options.onPropsMoved?.(moved);
    const propsChanged = props.removed.length + props.restored.length > 0;
    if (hasLayerChange(diff, "heights")) {
      terrain.rebuildArea(area.cells, isWaterChanged(diff), listReturnedStamps(diff, side));
      refresher.afterTerrain({ cells: area.cells, propsChanged, removed: props.removed });
      return;
    }
    options.refreshGround(area.cells);
    refresher.queue({ ...area, props: propsChanged, removed: props.removed });
    refresher.finishStroke();
  };
