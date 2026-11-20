import { refreshCanopyField } from "../../render-common/canopy-field";
import { refreshGroundZoneField } from "../../render-common/ground-zone-field";
import type {
  EditRevision,
  TaggedEditResult
} from "../../render-common/map-edit/edit-revision";
import type {
  RegionRebuild,
  RegionRebuildRequest} from "../../render-common/map-edit/region-rebuild";
import { refreshMineVertexField } from "../../render-common/mine-field";
import type { RendererMapEdit } from "../../render-common/renderer-contract";
import type { RockInstance } from "../../render-common/rocks/rock-instances";
import { listRegionChunks } from "../../render-common/terrain-chunks";
import type { NavWorld } from "../../render-common/wildlife/nav/nav-query";
import { type EditGround,refreshEditGround } from "../../shared/world/editing/build-refresh";
import type { EditRefusal } from "../../shared/world/editing/edit-refusal";
import type { MountainTemplate } from "../../shared/world/editing/terrain/mountain-template";
import {
  applyStampChanges,
  checkStampChange,
  getTerrainApplyRegion
} from "../../shared/world/editing/terrain/terrain-apply";
import type { TerrainBrushMode,TerrainBrushStroke } from "../../shared/world/editing/terrain/terrain-brush";
import {
  addStamp,
  clickStampAt,
  createTerrainEditState,
  editTerrainFeature,
  findStampAt,
  removeStampsNear,
  type StampChange,
  type StampKind,
  type TerrainEditState
} from "../../shared/world/editing/terrain/terrain-edit-state";
import {
  getFootprintRatio,
  getMaxLevel,
  getStampRadius,
  type TerrainStamp
} from "../../shared/world/editing/terrain/terrain-stamps";
import type { CellRegion } from "../../shared/world/grid-geometry";
import type { WorldData } from "../../shared/world/world-data";
import { createTerrainRebuildQueue } from "./terrain-rebuild-queue";

/** Quiet time after the last click before the edits apply (fast clicks coalesce), ms. */
const IDLE_MS = 120;
/** Level of a ridge drawn by a drag: a mountain range, a channel. */
const RIDGE_LEVELS = { lake: 2, mountain: 4 } as const;

type Point = { x: number; z: number };

/** Timings of the terrain edits (ms): applying them to the world, the worker rebuild. */
export interface TerrainStats {
  applyMs: number;
  /** Edits wait or are being applied and rebuilt. */
  busy: boolean;
  error: string;
  edits: number;
  /** Synchronous instant-height preview before the worker result installs. */
  previewMs: number;
  rebuildMs: number;
  /** Worker results released because a newer edit changed the world while they ran. */
  staleResults: number;
}

/** What one applied batch changed (the editor refreshes the rest: props, cover, minimap). */
interface TerrainBatch {
  cells: CellRegion;
  ground: EditGround;
  /** Props added (boulders) or removed (cleared footprints). */
  propsChanged: boolean;
  removed: number[];
}

export interface TerrainToolOptions {
  canEdit?: () => boolean;
  onDiscarded?: () => void;
  onTerrainEdited?: () => void;
  /** The animals' navigation after an edit. */
  animals: { setNav: (nav: NavWorld) => void };
  builders: {
    editedNav: (rocks: RockInstance[], revision?: EditRevision) => Promise<TaggedEditResult<NavWorld>>;
    editRegion: (request: RegionRebuildRequest) => Promise<RegionRebuild>;
    keepEditWorkers: () => void;
  };
  mapEdit: RendererMapEdit;
  /** A batch was applied (the worker rebuild of its terrain and rocks follows). */
  onApplied: (batch: TerrainBatch) => void;
  /** The exact cells of a pending batch, called before it mutates the world (history capture). */
  onBeforeApply?: (cells: CellRegion) => void;
  onRebuildError?: (message: string) => void;
  /** The animal homes follow the rebuilt cells (after their rocks and the navigation). */
  refreshHomes: (cells: CellRegion) => void;
  /** Moves the animals and workers inside `isInside` out to the nearest free spot. */
  relocate: (isInside: (x: number, z: number) => boolean) => void;
  /** Shares the editor's existing fixed-ground measurement instead of building a second one. */
  getGround?: () => EditGround;
  /** A loaded map's stamps (else the tool starts without any). */
  state?: TerrainEditState | null;
  world: WorldData;
}

/** The ghost of the next edit under the cursor: its footprint ring and the level it gives. */
export interface TerrainGhost {
  level: number;
  radius: number;
  /** The click raises the ground (a mountain up, a lake filled back), else lowers it. */
  raises: boolean;
  x: number;
  z: number;
}

/** Reverts a refused change (its stamp goes back to how it was). */
const revertChange = (state: TerrainEditState, change: StampChange) => {
  const rest = state.stamps.filter((stamp) => stamp !== change.after);
  state.stamps = change.before ? [...rest, change.before] : rest;
};

/**
 * The mountain tool: a click raises the stamp under the cursor one level (a boulder, an outcrop,
 * then a hill growing into a mountain), Ctrl + click lowers it, a drag draws a ridge. Clicks
 * change the stamp list at once (the ghost shows them); after a quiet moment the batch applies to
 * the world (pure edit operations) and the edited chunks rebuild in a worker (rocks, terrain,
 * water field), then the animals' navigation and their homes.
 */
export const createTerrainTool = (options: TerrainToolOptions) => {
  const { world } = options;
  const state = options.state ?? createTerrainEditState();
  const stats: TerrainStats = {
    applyMs: 0, busy: false, edits: 0, error: "", previewMs: 0, rebuildMs: 0, staleResults: 0
  };
  let queue: StampChange[] = [];
  let resets: TerrainBrushStroke[] = [];
  let queuedState: { nextId: number; stamps: TerrainStamp[] } | undefined;
  const rememberState = () => {
    queuedState ??= { nextId: state.nextId, stamps: state.stamps.map(stamp => ({ ...stamp })) };
  };
  const canEdit = () => options.canEdit?.() !== false;
  let timer = 0;
  /** The fixed ground of the build layers, measured once and then around each edit. */
  let ground: EditGround | null = options.getGround?.() ?? null;
  options.builders.keepEditWorkers();

  /** Animals and workers in the new footprints move out (never left in water or on rock). */
  const relocateUnits = (footprints: readonly TerrainStamp[]) => {
    if (footprints.length === 0) return;
    options.relocate((x, z) => footprints.some((stamp) => getFootprintRatio(stamp, x, z) < 1));
  };

  const rebuildQueue = createTerrainRebuildQueue(options, stats, busy => {
    stats.busy = busy || queue.length > 0 || resets.length > 0;
  });

  /**
   * Shows applied heights at once on the touched chunks (preview without the rock band) and
   * hands the area to the worker rebuild (started by the caller).
   */
  const showApplied = (cells: CellRegion, waterField: boolean) => {
    refreshMineVertexField(world, cells);
    refreshCanopyField(world, cells);
    refreshGroundZoneField(world, cells);
    const previewStarted = performance.now();
    options.mapEdit.previewRegion(listRegionChunks(world, cells));
    stats.previewMs = performance.now() - previewStarted;
    rebuildQueue.addTerrain(cells, waterField);
  };

  /**
   * Applies the queued clicks to the world at once (main thread, fast), shows the new heights
   * on the touched chunks immediately (preview without the rock band) and hands the area to the
   * worker rebuild.
   */
  const applyQueue = () => {
    if (queue.length === 0 && resets.length === 0) return;
    if (!canEdit()) {
      if (queuedState) { state.nextId = queuedState.nextId; state.stamps = queuedState.stamps; }
      queue = []; resets = []; queuedState = undefined; stats.busy = false;
      options.onDiscarded?.();
      return;
    }
    const changes = queue;
    const flatten = resets;
    resets = [];
    queue = [];
    const started = performance.now();
    relocateUnits(changes.flatMap((change) => (change.after ? [change.after] : [])));
    options.onBeforeApply?.(getTerrainApplyRegion(world, state, changes, flatten));
    const applied = applyStampChanges(world, state, changes, ground, flatten);
    queuedState = undefined;
    options.onTerrainEdited?.();
    ground = applied.ground;
    showApplied(applied.cells, applied.waterChanged);
    options.onApplied({
      cells: applied.cells,
      ground: applied.ground,
      propsChanged: applied.added.length + applied.removed.length > 0,
      removed: applied.removed
    });
    stats.applyMs = performance.now() - started;
    stats.edits += changes.length + flatten.length;
    void rebuildQueue.rebuild();
  };

  const schedule = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(applyQueue, IDLE_MS);
  };

  /** Queues a checked change; returns why it was refused, else null. */
  const queueChange = (change: StampChange | null): EditRefusal | null => {
    if (!change) {
      if (!queue.length && !resets.length) queuedState = undefined;
      return null;
    }
    const refusal = checkStampChange(world, state, change);
    if (refusal) {
      revertChange(state, change);
      if (!queue.length && !resets.length) queuedState = undefined;
      return refusal;
    }
    queue.push(change);
    stats.busy = true;
    schedule();
    return null;
  };

  /** The ghost of the next click: the stamp's footprint at its next (or previous) level. */
  const getGhost = (point: Point, lower: boolean, kind: StampKind): TerrainGhost | null => {
    const stamp = findStampAt(state, point.x, point.z, kind);
    const current = stamp?.level ?? 0;
    const level = lower ? current - 1 : Math.min(getMaxLevel({ kind }), current + 1);
    if (level <= 0) return null;
    const shape = { id: 0, kind, level, seed: 0, x: point.x, z: point.z };
    return {
      level,
      radius: getStampRadius(shape),
      raises: kind === "lake" ? lower : !lower,
      x: stamp?.x ?? point.x,
      z: stamp?.z ?? point.z
    };
  };

  return {
    /** Stops the pending terrain batch without applying it (island teardown). */
    dispose: () => {
      window.clearTimeout(timer);
      queue.length = 0;
      resets.length = 0;
      stats.busy = false;
    },
    /**
     * A click raises the stamp of the kind under the point (a mountain higher, a lake deeper and
     * wider) or with `lower` takes it a level back.
     */
    click: (point: Point, lower: boolean, seed: number, kind: StampKind, template?: MountainTemplate) => {
      if (!canEdit()) return null;
      rememberState();
      return queueChange(clickStampAt(state, point, { kind, lower, seed, template }));
    },
    /** Move, level-resize or remove a tracked authored feature through the normal checked batch. */
    editFeature: (id: number, values: { x: number; z: number; level: number } | null) => {
      if (!canEdit()) return null;
      rememberState();
      return queueChange(editTerrainFeature(state, id, values));
    },
    /** Applies the waiting clicks now (an undo or redo comes). */
    flush: () => {
      window.clearTimeout(timer);
      applyQueue();
    },
    getGhost,
    refreshNavigation: rebuildQueue.refreshNavigation,
    retryRebuild: () => { void rebuildQueue.rebuild(); },
    isQueued: () => queue.length > 0 || resets.length > 0,
    /**
     * An undo or redo restored the area (world and stamps): units in the footprints that came
     * back move out, the fixed ground is measured again and the area rebuilds as after an edit.
     */
    rebuildArea: (cells: CellRegion, waterField: boolean, footprints: readonly TerrainStamp[]) => {
      options.onTerrainEdited?.();
      relocateUnits(footprints);
      if (ground) refreshEditGround(world, ground, cells);
      showApplied(cells, waterField);
      void rebuildQueue.rebuild();
    },
    brushAt: (point: Point, radius: number, mode: TerrainBrushMode,
      controls: Pick<TerrainBrushStroke, "strength" | "targetHeight" | "protectCoast"> = {}) => {
      if (!canEdit()) return;
      rememberState();
      resets.push({ ...point, radius, mode, ...controls });
      stats.busy = true;
      schedule();
    },
    /** Reset ground removes stamps and flattens a dry meadow, including over original ocean. */
    resetAt: (point: Point, radius: number) => {
      if (!canEdit()) return 0;
      rememberState();
      const changes = removeStampsNear(state, point.x, point.z, radius);
      for (const change of changes) queueChange(change);
      resets.push({ ...point, radius });
      stats.busy = true;
      schedule();
      return changes.length + 1;
    },
    /** A drag: a ridge of mountains, or a channel of water, from `from` to `to`. */
    ridge: (from: Point, to: Point, seed: number, kind: StampKind, template?: MountainTemplate) => {
      if (!canEdit()) return null;
      rememberState();
      return queueChange(addStamp(state, from, RIDGE_LEVELS[kind ?? "mountain"], seed, { kind, template, to }));
    },
    /** The stamps and what applying them keeps (undo / redo restore it). */
    state,
    stats
  };
};

export type TerrainTool = ReturnType<typeof createTerrainTool>;
