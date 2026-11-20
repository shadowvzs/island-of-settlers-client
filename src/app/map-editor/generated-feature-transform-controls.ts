import type { FeatureTransformRuntime } from "../../shared/world/editing/terrain/generated-feature-runtime";
import { transformGeneratedFeature } from "../../shared/world/editing/terrain/generated-feature-transform";
import type { TerrainComponent } from "../../shared/world/editing/terrain/terrain-component";
import type { WorldData } from "../../shared/world/world-data";
import type { EditorHistory } from "./editor-history";
import type { EditRefresher } from "./editor-refresh";
import type { EditorStore } from "./editor-store";
import { editorMessage, MAP_EDITOR_MESSAGES as M } from "./messages";
import { createSectionStore } from "./section-store";
import type { TerrainTool } from "./terrain-tool";

export const createGeneratedFeatureTransformControls = (
  world: WorldData,
  terrain: TerrainTool,
  history: EditorHistory,
  store: EditorStore,
  selection: () => TerrainComponent | null,
  onEdit: () => boolean | void,
  refresher: EditRefresher,
  onPropsMoved?: (ids: readonly number[]) => void,
  runtime?: () => FeatureTransformRuntime
) => {
  const section = createSectionStore({ includeRivers: false, size: "100", x: "0", z: "0" });
  const transform = () => {
    const chosen = selection();
    if (!chosen) {
      store.setHint(M.hints.selectContourFirst, true);
      return;
    }
    if (terrain.stats.busy) {
      store.setHint(M.hints.seedWait, true);
      return;
    }
    if (!section.reportValidity("x", "z", "size")) return;
    if (onEdit() === false) return;
    history.begin();
    try {
      const result = transformGeneratedFeature(
        world,
        terrain.state,
        chosen,
        {
          offsetX: section.valueAsNumber("x"),
          offsetZ: section.valueAsNumber("z"),
          scale: section.valueAsNumber("size") / 100,
          includeRivers: section.get().includeRivers
        },
        runtime?.()
      );
      const change = {
        cells: result.cells,
        ground: true,
        mineStones: result.movedOreZones.length > 0,
        props: result.moved.length > 0,
        removed: result.moved,
        stoneCells: result.cells
      };
      history.note(change);
      if (result.moved.length) onPropsMoved?.(result.moved);
      refresher.queue(change);
      refresher.finishStroke();
      terrain.rebuildArea(result.cells, true, []);
      const clamped = result.clamped
        ? editorMessage(M.hints.transformClamped, { east: result.offsetX, south: result.offsetZ })
        : "";
      store.setHint(editorMessage(M.hints.transformDone, {
        changed: result.changed,
        clamped,
        moved: result.moved.length - result.reseated,
        oreZones: result.movedOreZones.length,
        reseated: result.reseated,
        stoneSources: result.movedStoneDeposits.length
      }));
    } catch {
      store.setHint(M.hints.transformFailed, true);
    } finally {
      history.endStroke();
    }
  };
  return {
    limits: { x: world.cellsX, z: world.cellsZ },
    section,
    setIncludeRivers: (includeRivers: boolean) => section.update({ includeRivers }),
    transform
  };
};

export type GeneratedFeatureTransformControls = ReturnType<typeof createGeneratedFeatureTransformControls>;
