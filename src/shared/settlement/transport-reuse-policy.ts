export type TransportAvailability = "idle" | "returning" | "unloading";

/** The dispatcher supplies only compatible, uncommitted units and an already validated pickup route. */
export interface TransportReuseCandidate<T> {
  atSource: boolean;
  availability: TransportAvailability;
  id: number;
  routeCost: number;
  value: T;
}

/** Lower is better; Infinity never qualifies (an unload elsewhere cannot take this job). */
export const reuseRank = <T>(candidate: TransportReuseCandidate<T>) => {
  if (candidate.availability === "unloading") return candidate.atSource ? 0 : Infinity;
  return candidate.atSource ? 1 : 2;
};

const qualifies = <T>(candidate: TransportReuseCandidate<T>) => Number.isFinite(reuseRank(candidate)) &&
  Number.isFinite(candidate.routeCost) && candidate.routeCost >= 0;

/** Whether a qualifying `candidate` replaces the qualifying `best` in `chooseTransportForJob`. */
export const outranks = <T, U>(candidate: TransportReuseCandidate<T>, best: TransportReuseCandidate<U>) => {
  const priority = reuseRank(candidate), bestRank = reuseRank(best);
  if (priority !== bestRank) return priority < bestRank;
  if (candidate.routeCost !== best.routeCost) return candidate.routeCost < best.routeCost;
  const returning = candidate.availability === "returning", oldReturning = best.availability === "returning";
  return (returning && !oldReturning) || (returning === oldReturning && candidate.id < best.id);
};

/**
 * The best qualifying candidate so far after offering `candidate`: the first of the best key wins,
 * so the result of a whole list depends only on candidates that are not strictly worse than it.
 */
export const preferCandidate = <T>(
  best: TransportReuseCandidate<T> | undefined, candidate: TransportReuseCandidate<T>
) => {
  if (!qualifies(candidate)) return best;
  return !best || outranks(candidate, best) ? candidate : best;
};

/**
 * Select a unit for an authorized job. Next-job demand ranking is handled separately below.
 * Finish a local unload first, then prefer local empty units, then the shortest actual pickup route.
 * An empty return wins equal-cost ties, avoiding needless return-home travel before another job.
 */
export const chooseTransportForJob = <T>(candidates: readonly TransportReuseCandidate<T>[]): T | undefined => {
  let best: TransportReuseCandidate<T> | undefined;
  for (const candidate of candidates) best = preferCandidate(best, candidate);
  return best?.value;
};

export interface NextTransportJobCandidate<T> {
  /** Uncovered need for this job's wares/people, after existing stock and committed arrivals. */
  remainingNeed: number;
  /** Length of the actual valid transport route, including required approaches. */
  routeDistance: number;
  /** Existing request order; lower is older. */
  order: number;
  value: T;
}

/** Owner policy: largest uncovered need, then shortest valid route, then oldest request. */
export const chooseNextTransportJob = <T>(candidates: readonly NextTransportJobCandidate<T>[]): T | undefined => {
  let best: NextTransportJobCandidate<T> | undefined;
  for (const candidate of candidates) {
    if (!Number.isFinite(candidate.remainingNeed) || candidate.remainingNeed <= 0 ||
      !Number.isFinite(candidate.routeDistance) || candidate.routeDistance < 0) continue;
    if (!best || candidate.remainingNeed > best.remainingNeed) { best = candidate; continue; }
    if (candidate.remainingNeed < best.remainingNeed) continue;
    if (candidate.routeDistance < best.routeDistance ||
      (candidate.routeDistance === best.routeDistance && candidate.order < best.order)) best = candidate;
  }
  return best?.value;
};
