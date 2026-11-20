import {
  type EditRevision,
  getEditRevision,
  sameEditRevision
} from "../../render-common/map-edit/edit-revision";
import { getKnownRocks, rememberIslandRocks } from "../../render-common/rocks/island-rock-instances";
import { forgetRockContact } from "../../render-common/rocks/rock-contact";
import { listRegionChunks } from "../../render-common/terrain-chunks";
import { type CellRegion,EMPTY_REGION, isRegionEmpty, unionRegions } from "../../shared/world/grid-geometry";
import type { WorldData } from "../../shared/world/world-data";
import { errorMessage } from "../helpers";
import type { TerrainStats, TerrainToolOptions } from "./terrain-tool";

const emptyWork = () => ({ cells: EMPTY_REGION, navigationCells: EMPTY_REGION, waterField: false });
type Work = ReturnType<typeof emptyWork>;

/** Whether a result was computed from the revision the queue is still waiting for. */
const isCurrent = (result: { revision: EditRevision }, requested: EditRevision, world: WorldData) =>
  sameEditRevision(result.revision, requested) &&
  sameEditRevision(requested, getEditRevision(world));

/**
 * Terrain and navigation share one queue so a late navigation result cannot replace newer edits.
 * Every worker payload carries the world revision it was queued for; a result is installed only
 * while that revision is still current. Otherwise it is released and its area is rebuilt again.
 */
export const createTerrainRebuildQueue = (
  options: TerrainToolOptions, stats: TerrainStats, setBusy: (busy: boolean) => void
) => {
  const { world } = options;
  let pending = emptyWork();
  let rebuilding = false;
  const hasWork = () => !isRegionEmpty(pending.cells) || !isRegionEmpty(pending.navigationCells);
  const requeue = (work: Work) => {
    pending = {
      cells: unionRegions(work.cells, pending.cells),
      navigationCells: unionRegions(work.navigationCells, pending.navigationCells),
      waterField: work.waterField || pending.waterField
    };
  };

  /**
   * Rebuilds one queued piece once. `done` also covers a released stale result (its area was
   * put back into `pending`); `failed` stops the loop for the explicit retry button.
   */
  const rebuildOne = async (work: Work): Promise<"done" | "failed"> => {
    const started = performance.now();
    try {
      const revision = getEditRevision(world);
      let rocks = getKnownRocks(world);
      if (!isRegionEmpty(work.cells)) {
        const result = await options.builders.editRegion({
          cells: work.cells, chunks: listRegionChunks(world, work.cells),
          modes: options.mapEdit.surfaceModes, placed: rocks, revision, waterField: work.waterField
        });
        // The payload was cloned when the worker started. A delayed dispatch or a newer edit
        // while it ran changes the revision, so its chunks/rocks must not be installed.
        if (!isCurrent(result, revision, world)) {
          stats.staleResults += 1;
          requeue(work);
          return "done";
        }
        rocks = result.placed;
        rememberIslandRocks(world, rocks);
        forgetRockContact(world);
        options.mapEdit.applyRegion(result);
      }
      // Keep busy until this promise finishes, including for navigation-only prop edits.
      const navRevision = getEditRevision(world);
      const nav = await options.builders.editedNav(rocks, navRevision);
      if (!isCurrent(nav, navRevision, world)) {
        stats.staleResults += 1;
        // The region was installed, so only navigation and homes are rebuilt: keep the edited
        // cells in the home refresh even when the newer edit queued its own region.
        pending.navigationCells = unionRegions(
          pending.navigationCells, unionRegions(work.cells, work.navigationCells));
        return "done";
      }
      options.animals.setNav(nav.value);
      options.refreshHomes(unionRegions(work.cells, work.navigationCells));
      stats.rebuildMs = performance.now() - started;
      return "done";
    } catch (error) {
      requeue(work);
      stats.error = errorMessage(error, "Map rebuild failed");
      options.onRebuildError?.(stats.error);
      return "failed";
    }
  };

  const rebuild = async (): Promise<void> => {
    if (rebuilding || !hasWork()) return;
    rebuilding = true;
    setBusy(true);
    stats.error = "";
    let failed = false;
    try {
      while (hasWork()) {
        const work = pending;
        pending = emptyWork();
        if (await rebuildOne(work) === "failed") {
          failed = true;
          break;
        }
      }
    } finally {
      rebuilding = false;
      // Retain failed work for the explicit retry button; do not spin or leave editing locked.
      setBusy(!failed && hasWork());
    }
  };
  return {
    addTerrain: (cells: CellRegion, waterField: boolean) => {
      pending.cells = unionRegions(pending.cells, cells);
      pending.waterField ||= waterField;
    },
    refreshNavigation: (cells: CellRegion) => {
      pending.navigationCells = unionRegions(pending.navigationCells, cells);
      void rebuild();
    },
    rebuild
  };
};
