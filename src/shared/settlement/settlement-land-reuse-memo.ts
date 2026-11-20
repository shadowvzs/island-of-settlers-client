import { countNavigation } from "./navigation-profile";
import { STORAGE_IDS } from "./production-rules";
import { isDoorExitQueueFull } from "./settlement-door-exit-queue";
import type { LandReuseJob } from "./settlement-land-reuse-scheduler";
import {
  type CarrierCrewLookup, createCarrierCrewLookup, createWalkingCarrierPool, type WalkingCarrierPool
} from "./settlement-land-transport-selection";
import { servesBuildingEconomy } from "./settlement-ownership";
import { availableIdleSettlers } from "./settlement-population";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "./settlement-types";
import type { TransportReuseCandidate } from "./transport-reuse-policy";

type StorageCandidate = TransportReuseCandidate<null>;
type BestUnit = SettlementActor | null | undefined;

/** A04 rollback switch: false recomputes every answer, exactly the pre-memo scheduler path. */
let landReusePassMemoEnabled = true;
export const setLandReusePassMemo = (enabled: boolean) => { landReusePassMemoEnabled = enabled; };

/**
 * A04: the answers of one unchanged settlement state during a reuse pass. Job collection, carrier
 * candidates and each job's best unit are pure reads of that state, so they are computed once and
 * shared by every actor of the pass. The owner calls `invalidate` after anything that may write
 * (a claim, a commit attempt or a released next-job), so no answer outlives the state it read.
 */
export const createLandReusePassMemo = (
  context: SettlementContext, collectJobs: (source?: number) => LandReuseJob[]
) => {
  const enabled = landReusePassMemoEnabled;
  const jobs = new Map<number | undefined, LandReuseJob[]>();
  const bestUnits = new Map<LandReuseJob, BestUnit>();
  const claimWalkers = new Map<SettlementBuilding, WalkingCarrierPool>();
  const plainWalkers = new Map<SettlementBuilding, WalkingCarrierPool>();
  const storages = new Map<SettlementBuilding, StorageCandidate[]>();
  let lookup: CarrierCrewLookup | undefined;

  const remember = <K, V>(map: Map<K, V>, key: K, compute: () => V) => {
    if (!enabled) return compute();
    if (map.has(key)) return map.get(key) as V;
    const value = compute();
    map.set(key, value);
    return value;
  };
  const crew = () => {
    if (!enabled) return createCarrierCrewLookup(context);
    lookup ??= createCarrierCrewLookup(context);
    return lookup;
  };
  /** A02 work counters (bench only): how often the job list is rebuilt and how long it is. */
  const collect = (source?: number) => {
    const collected = collectJobs(source);
    countNavigation("reuse.collectCalls");
    countNavigation("reuse.collectJobs", collected.length);
    return collected;
  };
  /** Finished storages with an idle settler that may leave, and their road cost to `source`. */
  const idleStorages = (source: SettlementBuilding) => {
    const candidates: StorageCandidate[] = [];
    for (const storage of context.buildings) {
      if (storage.construction !== 1 || !STORAGE_IDS.has(storage.typeId) ||
        !servesBuildingEconomy(context, storage, source) ||
        availableIdleSettlers(context, storage) < 1 || isDoorExitQueueFull(context, storage)) continue;
      const route = context.options.roads.route(storage.access, source.access);
      if (route) candidates.push({ atSource: storage.uid === source.uid, availability: "idle", id: storage.uid,
        routeCost: route.cost, value: null });
    }
    return candidates;
  };

  return {
    bestUnit: (job: LandReuseJob, compute: () => BestUnit) => remember(bestUnits, job, compute),
    crew,
    idleStorages: (source: SettlementBuilding) => remember(storages, source, () => idleStorages(source)),
    invalidate: () => {
      jobs.clear(); bestUnits.clear(); claimWalkers.clear(); plainWalkers.clear(); storages.clear();
      lookup = undefined;
    },
    jobs: (source?: number) => remember(jobs, source, () => collect(source)),
    walkers: (source: SettlementBuilding, allowClaim: boolean) =>
      remember(allowClaim ? claimWalkers : plainWalkers, source,
        () => createWalkingCarrierPool(context, source, allowClaim, true, crew()))
  };
};

export type LandReusePassMemo = ReturnType<typeof createLandReusePassMemo>;
