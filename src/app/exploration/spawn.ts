/**
 * Bounded, read-only spawn search for the home-island explorer (EXPLORE-01B). It samples the
 * injected `ExplorationGroundQuery` only: no terrain carve, prop move, navigation rebuild, ownership
 * claim or simulation mutation can happen here.
 */
import type {
  ExplorationGroundQuery,
  ExplorationSpawnPoint,
  ExplorationSpawnResult
} from "./contracts";
import {
  canStepExplorationPoint,
  EXPLORATION_BODY_RADIUS,
  EXPLORATION_EYE_CLEARANCE_RADIUS,
  isInsideExplorationMap
} from "./movement";

export const EXPLORATION_SPAWN_MAX_CANDIDATES = 512;
export const EXPLORATION_SPAWN_TIME_BUDGET_MS = 8;
export const EXPLORATION_SPAWN_FOCUS_RADIUS = 16;
export const EXPLORATION_SPAWN_ANCHOR_RADIUS = 8;
export const EXPLORATION_SPAWN_NEIGHBOUR_DISTANCE = 0.8;
export const EXPLORATION_SPAWN_MIN_NEIGHBOURS = 3;
export const EXPLORATION_SPAWN_COAST_WATER_DISTANCE = 1.8;
export const EXPLORATION_SPAWN_CONNECTED_DISTANCE = 0.6;
export const EXPLORATION_SPAWN_MIN_CONNECTED = 5;
export const EXPLORATION_SPAWN_MAX_HEIGHT_DRIFT = 0.25;

export interface ExplorationSpawnAnchor {
  x: number;
  z: number;
}

export interface ExplorationSpawnSearchOptions {
  /** First area to search; usually the retained RTS camera centre. */
  focus?: ExplorationSpawnAnchor;
  /** Safe HQ/harbour centres supplied by the session host. */
  landmarks?: readonly ExplorationSpawnAnchor[];
  maxCandidates?: number;
  timeBudgetMs?: number;
  /** Injected elapsed clock for the time budget; omitted means the count bound is the only bound. */
  now?: () => number;
}

interface Candidate {
  x: number;
  z: number;
}

interface SearchBudget {
  attempt: () => boolean;
  exhausted: () => boolean;
}

const finiteAnchor = (anchor: ExplorationSpawnAnchor | undefined) =>
  anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.z) ? anchor : undefined;

const clampAnchor = (ground: ExplorationGroundQuery, anchor: ExplorationSpawnAnchor): Candidate => {
  const margin = Math.min(1, Math.max(0, Math.min(ground.cellsX, ground.cellsZ) / 2));
  return {
    x: Math.min(ground.cellsX - margin, Math.max(margin, anchor.x)),
    z: Math.min(ground.cellsZ - margin, Math.max(margin, anchor.z))
  };
};

const sortCandidates = (candidates: Candidate[], focus: Candidate) => {
  candidates.sort((left, right) => {
    const leftDistance = (left.x - focus.x) ** 2 + (left.z - focus.z) ** 2;
    const rightDistance = (right.x - focus.x) ** 2 + (right.z - focus.z) ** 2;
    if (leftDistance !== rightDistance) return leftDistance - rightDistance;
    if (left.x !== right.x) return left.x - right.x;
    return left.z - right.z;
  });
  return candidates;
};

const collectAround = (
  focus: Candidate,
  radius: number,
  limit: number
): Candidate[] => {
  const candidates: Candidate[] = [];
  const wholeRadius = Math.max(0, Math.ceil(radius));
  for (let dz = -wholeRadius; dz <= wholeRadius; dz += 1) {
    for (let dx = -wholeRadius; dx <= wholeRadius; dx += 1) {
      candidates.push({ x: focus.x + dx, z: focus.z + dz });
    }
  }
  sortCandidates(candidates, focus);
  return candidates.slice(0, limit);
};

const collectMap = (
  ground: ExplorationGroundQuery,
  focus: Candidate,
  limit: number
): Candidate[] => {
  const area = Math.max(1, ground.cellsX * ground.cellsZ);
  const step = Math.max(1, Math.ceil(Math.sqrt(area / Math.max(1, limit))));
  const candidates: Candidate[] = [];
  for (let z = step / 2; z < ground.cellsZ; z += step) {
    for (let x = step / 2; x < ground.cellsX; x += step) {
      candidates.push({ x, z });
    }
  }
  sortCandidates(candidates, focus);
  return candidates.slice(0, limit);
};

const collectLandmarkCandidates = (
  ground: ExplorationGroundQuery,
  landmarks: readonly ExplorationSpawnAnchor[],
  limit: number
) => {
  const result: Candidate[] = [];
  const perLandmark = Math.max(1, Math.ceil(limit / Math.max(1, landmarks.length)));
  for (const landmark of landmarks) {
    if (result.length >= limit) break;
    const anchor = finiteAnchor(landmark);
    if (!anchor) continue;
    result.push(...collectAround(
      clampAnchor(ground, anchor),
      EXPLORATION_SPAWN_ANCHOR_RADIUS,
      perLandmark
    ));
  }
  return result.slice(0, limit);
};

const createTimeGate = (timeBudgetMs: number, now: (() => number) | undefined) => {
  const startedAt = now?.();
  let expired = false;
  return () => {
    if (expired) return true;
    if (!now || !Number.isFinite(startedAt)) return false;
    const current = now();
    expired = Number.isFinite(current) && current - startedAt! >= timeBudgetMs;
    return expired;
  };
};

/** One shared time gate and a per-stage candidate count keep every fallback reachable. */
const createStageBudget = (candidateLimit: number, expired: () => boolean): SearchBudget => {
  let attempts = 0;
  const exhausted = () => attempts >= candidateLimit || expired();
  return {
    attempt: () => {
      if (exhausted()) return false;
      attempts += 1;
      return true;
    },
    exhausted
  };
};

const neighbourOffsets = [
  [-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]
] as const;

/** Local, bounded flood fill: one isolated dry vertex does not count as a walking route. */
const hasConnectedWalkingRoom = (ground: ExplorationGroundQuery, x: number, z: number) => {
  const span = 2;
  const step = EXPLORATION_SPAWN_CONNECTED_DISTANCE;
  const size = Math.floor(span / step) * 2 + 1;
  const centre = Math.floor(size / 2);
  const points = Array.from({ length: size * size }, (_, index) => ({
    x: x + (index % size - centre) * step,
    z: z + (Math.floor(index / size) - centre) * step
  }));
  const visited = new Set<number>([centre * size + centre]);
  const queue = [centre * size + centre];
  let connected = 1;
  while (queue.length > 0 && connected < EXPLORATION_SPAWN_MIN_CONNECTED) {
    const current = queue.shift()!;
    const currentX = current % size, currentZ = Math.floor(current / size);
    for (const [dx, dz] of neighbourOffsets) {
      const nextX = currentX + dx, nextZ = currentZ + dz;
      if (nextX < 0 || nextZ < 0 || nextX >= size || nextZ >= size) continue;
      const next = nextZ * size + nextX;
      if (visited.has(next)) continue;
      const nextPoint = points[next]!;
      if (!canStepExplorationPoint(ground, x, z, nextPoint.x, nextPoint.z)) continue;
      visited.add(next);
      queue.push(next);
      connected += 1;
      if (connected >= EXPLORATION_SPAWN_MIN_CONNECTED) break;
    }
  }
  return connected >= EXPLORATION_SPAWN_MIN_CONNECTED;
};

const hasWalkingRoom = (ground: ExplorationGroundQuery, x: number, z: number) => {
  const distance = EXPLORATION_SPAWN_NEIGHBOUR_DISTANCE;
  let neighbours = 0;
  for (const [dx, dz] of neighbourOffsets) {
    if (canStepExplorationPoint(ground, x, z, x + dx * distance, z + dz * distance)) {
      neighbours += 1;
    }
  }
  if (neighbours < EXPLORATION_SPAWN_MIN_NEIGHBOURS) return false;
  return hasConnectedWalkingRoom(ground, x, z);
};

const isCoastCandidate = (ground: ExplorationGroundQuery, x: number, z: number) => {
  const distance = EXPLORATION_SPAWN_COAST_WATER_DISTANCE;
  return neighbourOffsets.some(([dx, dz]) => ground.isWater(x + dx * distance, z + dz * distance));
};

const validateCandidate = (
  ground: ExplorationGroundQuery,
  x: number,
  z: number
): ExplorationSpawnPoint | null => {
  if (!isInsideExplorationMap(ground, x, z, EXPLORATION_EYE_CLEARANCE_RADIUS)) return null;
  const height = ground.groundHeight(x, z);
  if (!Number.isFinite(height)) return null;
  if (ground.isWater(x, z) || !ground.isWalkable(x, z)) return null;
  if (!ground.isClear(x, z, EXPLORATION_BODY_RADIUS)) return null;
  if (!ground.isClear(x, z, EXPLORATION_EYE_CLEARANCE_RADIUS)) return null;
  if (!hasWalkingRoom(ground, x, z)) return null;
  return { owned: ground.isOwned(x, z), x, y: height, z };
};

/** Rechecks a selected point after async preparation; ownership, clearance or terrain may change. */
export const isExplorationSpawnPointValid = (
  ground: ExplorationGroundQuery,
  point: ExplorationSpawnPoint
) => {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) return false;
  const current = validateCandidate(ground, point.x, point.z);
  if (!current || current.owned !== point.owned) return false;
  return Math.abs(current.y - point.y) <= EXPLORATION_SPAWN_MAX_HEIGHT_DRIFT;
};

const evaluateCandidates = (
  ground: ExplorationGroundQuery,
  candidates: readonly Candidate[],
  budget: SearchBudget,
  cache: Map<string, ExplorationSpawnPoint | null>,
  accept: (point: ExplorationSpawnPoint) => boolean
) => {
  for (const candidate of candidates) {
    const key = `${candidate.x}:${candidate.z}`;
    let point = cache.get(key);
    if (point === undefined) {
      if (!budget.attempt()) return undefined;
      point = validateCandidate(ground, candidate.x, candidate.z);
      cache.set(key, point);
    }
    if (point && accept(point)) return point;
  }
  return undefined;
};

const collectCoast = (
  ground: ExplorationGroundQuery,
  candidates: readonly Candidate[],
  budget: SearchBudget,
  cache: Map<string, ExplorationSpawnPoint | null>,
  coastCache: Map<string, boolean>
) => {
  let unowned: ExplorationSpawnPoint | undefined;
  for (const candidate of candidates) {
    if (budget.exhausted()) break;
    const key = `${candidate.x}:${candidate.z}`;
    let coast = coastCache.get(key);
    if (coast === undefined) {
      coast = isCoastCandidate(ground, candidate.x, candidate.z);
      coastCache.set(key, coast);
    }
    if (!coast) continue;
    const found = evaluateCandidates(ground, [candidate], budget, cache, point => {
      if (point.owned) return true;
      unowned ??= point;
      return false;
    });
    if (found) return found;
  }
  return unowned;
};

const refusal: ExplorationSpawnResult = { ok: false, reason: "no-safe-spawn" };

/**
 * Finds a safe starting point in this order: owned land around the current focus, dry connected
 * coast, supplied HQ/harbour anchors, then any owned safe point. Every stage is bounded by the
 * candidate/time budget and returns the typed refusal without changing the world.
 */
export const findExplorationSpawn = (
  ground: ExplorationGroundQuery,
  options: ExplorationSpawnSearchOptions = {}
): ExplorationSpawnResult => {
  const requestedCandidates = options.maxCandidates ?? EXPLORATION_SPAWN_MAX_CANDIDATES;
  const maxCandidates = Number.isFinite(requestedCandidates)
    ? Math.max(1, Math.floor(requestedCandidates))
    : EXPLORATION_SPAWN_MAX_CANDIDATES;
  const requestedTime = options.timeBudgetMs ?? EXPLORATION_SPAWN_TIME_BUDGET_MS;
  const timeBudgetMs = Number.isFinite(requestedTime) ? Math.max(0, requestedTime) : 0;
  const focus = clampAnchor(ground, finiteAnchor(options.focus) ?? {
    x: ground.cellsX / 2,
    z: ground.cellsZ / 2
  });
  const expired = createTimeGate(timeBudgetMs, options.now);
  const focusLimit = Math.max(1, Math.floor(maxCandidates * 0.4));
  const coastLimit = Math.max(0, Math.min(maxCandidates - focusLimit, Math.ceil(maxCandidates * 0.35)));
  const fallbackLimit = Math.max(0, maxCandidates - focusLimit - coastLimit);
  const focusBudget = createStageBudget(focusLimit, expired);
  const coastBudget = createStageBudget(coastLimit, expired);
  const fallbackBudget = createStageBudget(fallbackLimit, expired);
  const cache = new Map<string, ExplorationSpawnPoint | null>();
  const coastCache = new Map<string, boolean>();
  const focusCandidates = collectAround(focus, EXPLORATION_SPAWN_FOCUS_RADIUS, focusLimit);
  const landmarkCandidates = collectLandmarkCandidates(
    ground, options.landmarks ?? [], fallbackLimit
  );
  const mapCandidates = collectMap(ground, focus, coastLimit + fallbackLimit);
  const coastPool = [...focusCandidates, ...landmarkCandidates, ...mapCandidates];

  const focusOwned = evaluateCandidates(
    ground, focusCandidates, focusBudget, cache, point => point.owned
  );
  if (focusOwned) return { ok: true, point: focusOwned };

  const coast = collectCoast(ground, coastPool, coastBudget, cache, coastCache);
  if (coast) return { ok: true, point: coast };

  const anchorOwned = evaluateCandidates(
    ground, landmarkCandidates, fallbackBudget, cache, point => point.owned
  );
  if (anchorOwned) return { ok: true, point: anchorOwned };

  const mapOwned = evaluateCandidates(
    ground, mapCandidates, fallbackBudget, cache, point => point.owned
  );
  if (mapOwned) return { ok: true, point: mapOwned };

  return refusal;
};
