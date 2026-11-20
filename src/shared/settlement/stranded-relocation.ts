import { DMath } from "../math/deterministic-math";
import { sampleSmooth } from "../world/grid-geometry";
import { STORAGE_IDS } from "./production-rules";
import { carrierRoadRecoveryPath } from "./settlement-carrier-road-recovery";
import { isOwnBuilding } from "./settlement-home";
import { isFreeCivilian, releasePersonWork } from "./settlement-person-release";
import { createTransientMap } from "./settlement-transient-state";
import type { SettlementActor, SettlementBuilding, SettlementContext, SettlementPoint } from "./settlement-types";
import { stockLandAt } from "./stock-lands";

/** A person who faded out where it stood and in at a storage (presentation only). */
export interface StorageFade {
  actor: number;
  from: SettlementPoint;
  to: SettlementPoint;
}

/** People relocated per half-second scheduler step: isolation is never urgent. */
const RELOCATIONS_PER_STEP = 4;
const MAX_PENDING_FADES = 32;

interface StrandedScan {
  /** Actor uids still to re-check and relocate, ascending. */
  queue: number[];
  /** The isolation changed (or the island loaded): rebuild the queue on the next scheduler step. */
  dirty: boolean;
}

/** Transient: a load starts with a dirty scan, so client, catch-up and verifier rescan on the same step. */
const scans = createTransientMap<StrandedScan>();
const fades = createTransientMap<StorageFade[]>();

const scanOf = (context: SettlementContext) => {
  let scan = scans.get(context);
  if (!scan) {
    scan = { dirty: true, queue: [] };
    scans.set(context, scan);
  }
  return scan;
};

/** A removed bridge or building may have cut people off from every storage: rescan soon. */
export const markStrandedScan = (context: SettlementContext) => {
  scanOf(context).dirty = true;
};

const ownStorages = (context: SettlementContext) => context.buildings.filter(building =>
  building.construction === 1 && STORAGE_IDS.has(building.typeId) && isOwnBuilding(building));

/** The nearest storage the person can reach by road, else the nearest one at all (ties by uid). */
const returnStorage = (context: SettlementContext, actor: SettlementActor): SettlementBuilding | undefined => {
  const distance = (building: SettlementBuilding) =>
    DMath.hypot(building.access.x - actor.x, building.access.z - actor.z);
  const stores = ownStorages(context).sort((a, b) => distance(a) - distance(b) || a.uid - b.uid);
  return stores.find(store => carrierRoadRecoveryPath(context, actor, store.access) !== null) ?? stores[0];
};

const recordFade = (context: SettlementContext, fade: StorageFade) => {
  // Bounded: a headless island never takes them.
  const list = (fades.get(context) ?? []).slice(1 - MAX_PENDING_FADES);
  list.push(fade);
  fades.set(context, list);
};

/**
 * The person fades out where it is and reappears at the storage's road access; the demolition return
 * then walks it in, deposits whatever it carries and retires it there. False without any own storage.
 */
export const relocateToStorage = (context: SettlementContext, actor: SettlementActor) => {
  const storage = returnStorage(context, actor);
  if (!storage) return false;
  releasePersonWork(context, actor);
  const from = { x: actor.x, z: actor.z }, to = { x: storage.access.x, z: storage.access.z };
  const { world } = context.options;
  Object.assign(actor, { action: "idle", bridgeWait: undefined, building: storage.uid, demolitionReturning: true,
    home: storage.uid, navigationRecovery: undefined, path: [], pathIndex: 0, phase: "demolitionBlocked",
    queueTarget: undefined, queueWait: 0, stockBuilding: undefined, stockContact: undefined, visible: true,
    x: to.x, y: sampleSmooth(world, world.heights, to.x, to.z), z: to.z });
  recordFade(context, { actor: actor.uid, from, to });
  return true;
};

/** Fades since the last call, for the presentation (never saved, never read by the simulation). */
export const takeStorageFades = (context: SettlementContext): StorageFade[] => {
  const list = fades.get(context);
  if (!list?.length) return [];
  fades.set(context, []);
  return list;
};

/** Civilians the relocation may move: free civilians who are not evacuating a Catapult Tower. */
const isRelocatable = (actor: SettlementActor) => isFreeCivilian(actor) && !actor.catapultEvacuation;

/**
 * Stock lands holding an own storage the island's people can enter, or one being built there (a colony
 * founding crew lands before its harbour stands and must stay).
 */
const storageLands = (context: SettlementContext) => new Set(context.buildings
  .filter(building => STORAGE_IDS.has(building.typeId) && isOwnBuilding(building))
  .map(storage => stockLandAt(context, storage.access)));

const isStranded = (context: SettlementContext, actor: SettlementActor, lands: ReadonlySet<number>) => {
  if (!isRelocatable(actor)) return false;
  const land = stockLandAt(context, actor);
  return land >= 0 && !lands.has(land);
};

/**
 * Once per half-second scheduler step, after an isolation change or a load: people left on a stock
 * land without any storage go home to the nearest storage with a fade, a few per step in uid order.
 * The scan reads only saved state (positions, buildings, roads), so every replay relocates alike.
 */
export const updateStrandedRelocation = (context: SettlementContext) => {
  const scan = scanOf(context);
  if (scan.dirty) {
    scan.dirty = false;
    if (!ownStorages(context).length) { scan.queue = []; return; }
    const lands = storageLands(context);
    scan.queue = context.actors.filter(actor => isStranded(context, actor, lands))
      .map(actor => actor.uid).sort((a, b) => a - b);
    return;
  }
  if (!scan.queue.length) return;
  const lands = storageLands(context);
  for (const uid of scan.queue.splice(0, RELOCATIONS_PER_STEP)) {
    const actor = context.actors.find(entry => entry.uid === uid);
    if (actor && isStranded(context, actor, lands)) relocateToStorage(context, actor);
  }
};
