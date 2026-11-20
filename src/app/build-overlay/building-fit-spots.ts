import { BLOCKING, BUILD, SLOPE, type WorldData } from "../../shared/world/world-data";
import { normalizeTurns, rotatedFootprint } from "../settlement/building-plot";
import { hasKnownMineDeposit } from "./build-spots";

/** The building the player is placing and its quarter turns. */
export interface FitSelection {
  rotation: number;
  typeId: number;
}

export interface BuildingFitSpotOptions {
  world: WorldData;
  getOwnership: () => Uint8Array | undefined;
  /** The authoritative placement rule (null: allowed). */
  validatePlacement: (typeId: number, x: number, z: number, rotation: number) => string | null;
  /** Clock for the per-frame budget (tests inject a fake). */
  now?: () => number;
}

/** One finished or progressing scan of every plot the selected building may use. */
interface FitScan {
  /** Top-left cells (z * cellsX + x) that passed the cheap prefilter, scanned in order. */
  candidates: Int32Array;
  depth: number;
  /** Valid plots found so far. */
  found: number;
  key: string;
  /** 1 per top-left cell where the building fits (0: it does not). */
  marks: Uint8Array;
  next: number;
  rotation: number;
  selectionKey: string;
  typeId: number;
  width: number;
}

/** Validator calls between two clock reads (a validation costs a few microseconds). */
const CLOCK_STRIDE = 16;

export const isMineBuilding = (typeId: number) => typeId >= 10 && typeId <= 13;

/**
 * Cheap necessary conditions of the shared placement rules for one footprint cell (owned
 * territory, solid ground, build capacity, slope). A plot whose every cell passes still goes
 * through the full validator; a plot with one failing cell can never be valid.
 */
const isCandidateCell = (world: WorldData, owned: Uint8Array | undefined, cell: number, mine: boolean) => {
  if (owned && owned[cell] !== 1) return false;
  const blocking = world.blocking[cell];
  if (blocking === BLOCKING.water || blocking === BLOCKING.cliff) return false;
  const slope = world.slopeClass?.[cell] ?? SLOPE.flat;
  if (slope === SLOPE.cliff) return false;
  const ground = world.buildCap?.[cell] ?? world.buildClass[cell]!;
  if (mine) return ground >= BUILD.flag;
  return ground >= BUILD.small && ground <= BUILD.large && slope <= SLOPE.gentle;
};

/** Cell bounds of the owned territory (the whole grid when nothing restricts it). */
const ownedBounds = (world: WorldData, owned: Uint8Array | undefined) => {
  const bounds = { maxX: world.cellsX - 1, maxZ: world.cellsZ - 1, minX: 0, minZ: 0 };
  if (!owned) return bounds;
  Object.assign(bounds, { maxX: -1, maxZ: -1, minX: world.cellsX, minZ: world.cellsZ });
  for (let cell = 0; cell < owned.length; cell++) {
    if (owned[cell] !== 1) continue;
    const x = cell % world.cellsX, z = (cell - x) / world.cellsX;
    bounds.minX = Math.min(bounds.minX, x); bounds.maxX = Math.max(bounds.maxX, x);
    bounds.minZ = Math.min(bounds.minZ, z); bounds.maxZ = Math.max(bounds.maxZ, z);
  }
  return bounds;
};

/**
 * Top-left cells whose whole footprint passes the prefilter: a summed-area table over the owned
 * bounds answers each footprint in O(1), so only plausible plots reach the full validator.
 */
export const listFitCandidates = (
  world: WorldData, owned: Uint8Array | undefined, width: number, depth: number, mine: boolean
) => {
  const { maxX, maxZ, minX, minZ } = ownedBounds(world, owned);
  const spanX = maxX - minX + 1, spanZ = maxZ - minZ + 1;
  if (spanX < width || spanZ < depth) return new Int32Array(0);
  const stride = spanX + 1, sums = new Int32Array(stride * (spanZ + 1));
  for (let z = 0; z < spanZ; z++) {
    let row = 0;
    for (let x = 0; x < spanX; x++) {
      row += Number(isCandidateCell(world, owned, (z + minZ) * world.cellsX + x + minX, mine));
      sums[(z + 1) * stride + x + 1] = sums[z * stride + x + 1]! + row;
    }
  }
  const candidates: number[] = [], area = width * depth;
  for (let z = 0; z + depth <= spanZ; z++)
    for (let x = 0; x + width <= spanX; x++) {
      const total = sums[(z + depth) * stride + x + width]! - sums[z * stride + x + width]! -
        sums[(z + depth) * stride + x]! + sums[z * stride + x]!;
      if (total === area) candidates.push((z + minZ) * world.cellsX + x + minX);
    }
  return Int32Array.from(candidates);
};

/** Candidates nearest the focus (the camera centre) first, so the markers in view appear first. */
const sortNearestFirst = (
  candidates: Int32Array, cellsX: number, focus: { x: number; z: number }, width: number, depth: number
) => {
  const distance = (cell: number) => {
    const x = cell % cellsX, dx = x + width / 2 - focus.x, dz = (cell - x) / cellsX + depth / 2 - focus.z;
    return dx * dx + dz * dz;
  };
  return candidates.sort((first, second) => distance(first) - distance(second));
};

/**
 * Every plot inside our territory where the selected building can be placed (the preview ghosts
 * pick from these). Scans are cached per building, rotation and placement revision, and run
 * time sliced: `update` spends at most its budget per frame. A revision change keeps showing
 * the previous result until the rescan finishes (no flicker, and a rescan always completes even
 * while revisions keep changing); a new building or rotation shows its scan as it progresses.
 */
export const createBuildingFitSpots = (options: BuildingFitSpotOptions) => {
  const { world } = options;
  const now = options.now ?? (() => performance.now());
  let active: FitScan | null = null, shown: FitScan | null = null, revision = 0;

  const startScan = (
    selection: FitSelection, key: string, selectionKey: string, focus: { x: number; z: number }
  ): FitScan => {
    const { depth, turns, width } = rotatedFootprint(selection.typeId, selection.rotation);
    const owned = options.getOwnership();
    const candidates = sortNearestFirst(
      listFitCandidates(world, owned, width, depth, isMineBuilding(selection.typeId)),
      world.cellsX, focus, width, depth
    );
    return { candidates, depth, found: 0, key, marks: new Uint8Array(world.cellsX * world.cellsZ), next: 0,
      rotation: turns, selectionKey, typeId: selection.typeId, width };
  };

  const checkCandidate = (scan: FitScan, cell: number) => {
    const x = cell % world.cellsX, z = (cell - x) / world.cellsX;
    const centreX = x + scan.width / 2, centreZ = z + scan.depth / 2;
    const plot = { depth: scan.depth, width: scan.width, x: centreX, z: centreZ };
    if (isMineBuilding(scan.typeId) && !hasKnownMineDeposit(world, scan.typeId, plot)) return;
    if (options.validatePlacement(scan.typeId, centreX, centreZ, scan.rotation) !== null) return;
    scan.marks[cell] = 1;
    scan.found++;
  };

  /** Validates candidates until done or out of budget; true when it validated any. */
  const advance = (scan: FitScan, budgetMs: number) => {
    const deadline = now() + budgetMs, start = scan.next;
    while (scan.next < scan.candidates.length) {
      checkCandidate(scan, scan.candidates[scan.next++]!);
      if ((scan.next - start) % CLOCK_STRIDE === 0 && now() >= deadline) break;
    }
    return scan.next > start;
  };

  const isDone = (scan: FitScan) => scan.next >= scan.candidates.length;

  const clear = () => {
    if (!shown && !active) return;
    active = null; shown = null; revision++;
  };

  /**
   * Advances the scan of `selection` under `placementKey`, nearest `focus` first; returns the
   * fit-spot revision.
   */
  const update = (
    selection: FitSelection | null, placementKey: string, focus = { x: 0, z: 0 }, budgetMs = 2
  ) => {
    if (!selection) { clear(); return revision; }
    const selectionKey = `${selection.typeId}/${normalizeTurns(selection.rotation)}`;
    const key = `${selectionKey}/${placementKey}`;
    if (shown?.selectionKey !== selectionKey) {
      active = startScan(selection, key, selectionKey, focus); shown = active; revision++;
    } else if ((!active || isDone(active)) && shown.key !== key && active?.key !== key) {
      active = startScan(selection, key, selectionKey, focus);
    }
    if (!active || isDone(active)) return revision;
    const progressed = advance(active, budgetMs);
    if (active === shown && progressed) revision++;
    if (active !== shown && isDone(active)) { shown = active; revision++; }
    return revision;
  };

  return {
    /** True while a scan still has candidates to validate. */
    isScanning: () => !!active && !isDone(active),
    /** The shown fit spots: 1 per valid top-left cell, with the plot size (null: none). */
    markers: () => shown && { depth: shown.depth, marks: shown.marks, width: shown.width },
    /** True once a complete scan of the selection found no valid plot anywhere in the territory. */
    noSpace: () => !!shown && isDone(shown) && shown.found === 0,
    revision: () => revision,
    update
  };
};

