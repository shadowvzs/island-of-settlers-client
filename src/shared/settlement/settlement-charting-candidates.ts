import { BLOCKING, type HarbourSpot, type WorldData } from "../world/world-data";
import { storedHarbourSpots } from "./harbour-spot-index";
import { shouldVerifyNavigationReuse } from "./navigation-change-journal";
import { type ChartingChangeBounds, createChartingChanges } from "./settlement-charting-changes";
import { isOwnBuilding } from "./settlement-home";
import { landmassAt } from "./settlement-landmass-index";
import type { NavalExpedition } from "./settlement-naval-fleet";
import type { SettlementContext, SettlementPoint } from "./settlement-types";

const SITE_STEP = 3;
const COAST_REACH = 10;
const MAX_ANCHORS = 8192;
const MAX_CANDIDATE_SITES = 2048;
/** Tiles round a changed area within which a validated site proof is renewed. */
const RENEW_REACH = 32;

export interface AnchoredSite {
  x: number;
  z: number;
  rotation: number;
  rotations: number[];
  water: SettlementPoint;
}
interface CandidateCache {
  revision: string;
  /** Terrain/topology identity: observation may reuse the list while buildings/roads change. */
  anchorRevision: string;
  sites: AnchoredSite[];
}
type RotationProof = NavalExpedition | null;
const ROTATIONS = [0, 1, 2, 3] as const;
interface AnchorCache {
  anchors: SettlementPoint[];
  revision: string;
}

const nearSea = (sea: Uint8Array, world: WorldData, x: number, z: number) => {
  for (let dz = -COAST_REACH; dz <= COAST_REACH; dz += 2)
    for (let dx = -COAST_REACH; dx <= COAST_REACH; dx += 2) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= world.cellsX || nz >= world.cellsZ) continue;
      if (sea[nz * world.cellsX + nx]) return true;
    }
  return false;
};

const scanAnchors = (sea: Uint8Array, world: WorldData) => {
  const result: SettlementPoint[] = [];
  for (let z = SITE_STEP; z < world.cellsZ - SITE_STEP && result.length < MAX_ANCHORS; z += SITE_STEP)
    for (let x = SITE_STEP; x < world.cellsX - SITE_STEP && result.length < MAX_ANCHORS; x += SITE_STEP) {
      if (world.blocking[z * world.cellsX + x] === BLOCKING.water || !nearSea(sea, world, x, z)) continue;
      result.push({ x, z });
    }
  return result;
};

interface PendingAnchor {
  key: string;
  rotations: readonly number[];
  x: number;
  z: number;
}
/** Validation keys start with the anchor's "x:z" (local renewal reads them). */
const scanAnchor = (anchor: SettlementPoint): PendingAnchor =>
  ({ key: `${anchor.x}:${anchor.z}`, rotations: ROTATIONS, x: anchor.x, z: anchor.z });
/** HARBOUR-SPOTS: stored spots carry their validated rotation; one site query each instead of four. */
const spotAnchors = (spots: readonly HarbourSpot[]): PendingAnchor[] => spots.map(spot =>
  ({ key: `${spot.x}:${spot.z}:spot${spot.rotation}`, rotations: [spot.rotation], x: spot.x, z: spot.z }));

/** The anchor's valid rotations, in order, with the departure water of the first one. */
const anchoredSite = (anchor: PendingAnchor, proofs: readonly RotationProof[]): AnchoredSite | null => {
  const rotations = anchor.rotations.filter((_, index) => proofs[index]);
  const water = proofs.find(Boolean)?.water;
  return water && rotations.length ? { rotation: rotations[0]!, rotations, water, x: anchor.x, z: anchor.z } : null;
};

/**
 * Bounded harbour anchors on a coarse grid, validated per rotation by the caller's current-site
 * query. Anchors are cached by topology revision; validated sites by the wider build/road revision.
 */
export const createChartingCandidates = (
  context: SettlementContext, sea: Uint8Array, site: (point: { x: number; z: number; rotation: number }) => NavalExpedition | null
) => {
  const { world } = context.options;
  let anchors: AnchorCache | null = null;
  let cache: CandidateCache | null = null;
  const validated = new Map<string, AnchoredSite | null>();
  const changes = createChartingChanges(context);
  const anchorRevision = () => `${world.seed}:${world.cellsX}:${world.cellsZ}:${world.terrainRevision ?? 0}`;
  const revision = () => [anchorRevision(), world.buildRevision ?? 0, context.navigationRevision ?? 0,
    context.options.roads.revision ?? 0].join(":");

  /**
   * Water connectivity/clearance cannot change under local changes (only dry vertices above the sea
   * may move, water blocking and lakes stay), so the coarse anchors stay identical and only dry
   * footprint/shore/path proofs near a change need renewal.
   * The canonical 8-tile coast search accepts ground paths <=15 tiles from the entrance;
   * 32 tiles conservatively includes that path, the harbour entrance offset and sampling.
   */
  const renewNear = (bounds: readonly ChartingChangeBounds[]) => {
    for (const key of validated.keys()) {
      const [x, z] = key.split(":").map(Number);
      if (bounds.some(area => x! >= area.minX - RENEW_REACH && x! <= area.maxX + RENEW_REACH &&
        z! >= area.minZ - RENEW_REACH && z! <= area.maxZ + RENEW_REACH)) validated.delete(key);
    }
    if (anchors) anchors.revision = anchorRevision();
  };

  const anchorList = () => {
    const current = anchorRevision();
    if (anchors?.revision === current) return anchors.anchors;
    anchors = { anchors: scanAnchors(sea, world), revision: current };
    return anchors.anchors;
  };

  /** Owned landmasses (a current-player building) never become expedition targets. */
  const uncoveredLandmasses = (stored: readonly HarbourSpot[], result: readonly AnchoredSite[]) => {
    const covered = new Set(result.map(entry => landmassAt(world, entry)));
    for (const building of context.buildings)
      if (isOwnBuilding(building)) covered.add(landmassAt(world, building));
    const uncovered = new Set<number>();
    for (const spot of stored) {
      const landmass = landmassAt(world, spot);
      if (landmass >= 0 && !covered.has(landmass)) uncovered.add(landmass);
    }
    return uncovered;
  };
  /**
   * The anchors to prove: the stored harbour spots when the map has them, else the coarse coast
   * scan. An unowned island whose every stored spot was built over falls back to its own scan.
   */
  const primaryAnchors = () => {
    const stored = storedHarbourSpots(world);
    return stored.length ? spotAnchors(stored) : anchorList().map(scanAnchor);
  };
  const fallbackAnchors = (result: readonly AnchoredSite[], scan: () => readonly SettlementPoint[]) => {
    const stored = storedHarbourSpots(world);
    const uncovered = stored.length ? uncoveredLandmasses(stored, result) : null;
    if (!uncovered?.size) return [];
    return scan().filter(anchor => uncovered.has(landmassAt(world, anchor))).map(scanAnchor);
  };

  /** Strict/dev check: a locally renewed list must equal a complete recomputation. */
  const verifyRenewed = (sites: readonly AnchoredSite[]) => {
    const fresh: AnchoredSite[] = [];
    const prove = (pending: readonly PendingAnchor[]) => {
      for (const anchor of pending) {
        if (fresh.length >= MAX_CANDIDATE_SITES) return;
        const entry = anchoredSite(anchor, anchor.rotations.map(rotation => site({ ...anchor, rotation })));
        if (entry) fresh.push(entry);
      }
    };
    prove(primaryAnchors());
    prove(fallbackAnchors(fresh, () => scanAnchors(sea, world)));
    if (JSON.stringify(fresh) !== JSON.stringify(sites)) throw new Error("Stale harbour charting proof reused");
  };

  /** Proves `pending` into `result`; returns the restarted build's list when the world changed. */
  const validateAnchors = function* (pending: readonly PendingAnchor[], result: AnchoredSite[],
    progress: { completed: number; total: number }, current: string
  ): Generator<{ completed: number; total: number }, AnchoredSite[] | undefined, unknown> {
    for (const anchor of pending) {
      if (result.length >= MAX_CANDIDATE_SITES) return undefined;
      if (validated.has(anchor.key)) {
        const existing = validated.get(anchor.key);
        progress.completed += 4;
        if (existing) result.push(existing);
        continue;
      }
      const proofs: RotationProof[] = [];
      for (const rotation of anchor.rotations) {
        proofs.push(site({ x: anchor.x, z: anchor.z, rotation }));
        yield { completed: ++progress.completed, total: progress.total };
        // Loading yields to the browser. A replaced/edited world cannot publish mixed-revision proofs.
        if (revision() !== current) return yield* build();
      }
      progress.completed += 4 - anchor.rotations.length;
      const entry = anchoredSite(anchor, proofs);
      validated.set(anchor.key, entry);
      if (entry) result.push(entry);
    }
    return undefined;
  };

  const build = function* (): Generator<{ completed: number; total: number }, AnchoredSite[], unknown> {
    const current = revision();
    if (cache?.revision === current) return cache.sites;
    const local = cache ? changes.changedBounds() : null;
    changes.mark();
    if (local) renewNear(local);
    else validated.clear();
    const result: AnchoredSite[] = [], pending = primaryAnchors();
    const progress = { completed: 0, total: pending.length * 4 };
    const restarted = yield* validateAnchors(pending, result, progress, current);
    if (restarted) return restarted;
    const fallback = fallbackAnchors(result, anchorList);
    progress.total += fallback.length * 4;
    const restartedFallback = yield* validateAnchors(fallback, result, progress, current);
    if (restartedFallback) return restartedFallback;
    if (local && shouldVerifyNavigationReuse()) verifyRenewed(result);
    cache = { anchorRevision: anchorRevision(), revision: current, sites: result };
    return result;
  };
  const list = () => {
    const work = build();
    let step = work.next();
    while (!step.done) step = work.next();
    return step.value;
  };
  /**
   * Fog observation only adds sites; build/road changes invalidate usability, not the anchor set.
   * Reuse the topology-matched list so a landing tick cannot rescan every harbour candidate.
   */
  const observe = () => {
    const current = anchorRevision();
    return cache && cache.anchorRevision === current ? cache.sites : list();
  };

  const clear = () => { anchors = null; cache = null; validated.clear(); changes.clear(); };
  /** An in-place snapshot reload keeps the proofs (the next query compares the restored inputs). */
  const afterInPlaceReload = (restored: boolean) => {
    if (!restored) clear();
  };
  return { afterInPlaceReload, clear, list, observe, prewarm: build, revision };
};
