import { isReliefDonationWare } from "../progression/relief-quests";
import { escrowCustodyPools, repointEscrowCustody } from "../trade/trade-custody";
import { isEscrowCollected, stageHeldEscrow } from "../trade/trade-escrow";
import { reserveFromStorages, tradeAvailableStock } from "../trade/trade-island";
import { validTradePaidCustody } from "../trade/trade-save";
import type { TradeEscrow } from "../trade/trade-types";
import { isSaveGoods, isSaveInteger, isSaveObject } from "./save-validation";
import { isOwnBuilding } from "./settlement-home";
import type { NavalShip } from "./settlement-naval-fleet";
import type { Goods, SettlementBuilding, SettlementContext } from "./settlement-types";
import { storageContribution } from "./storage-capacity";

export interface ReliefCollectionRequest {
  version: 1;
  questId: string;
  ware: string;
  amount: number;
  harbourUid?: number;
}
export interface ReliefCollectionJob extends ReliefCollectionRequest {
  harbourUid: number;
  escrow: TradeEscrow;
  loaded: number;
  departed: boolean;
  shipId?: number;
}
export interface ReliefCollectionSave { version: 1; jobs: ReliefCollectionJob[] }
export interface ReliefShipPort {
  send(harbourUid: number, questId: string, collecting: boolean): number | null;
  ready(shipId: number): void;
  find(shipId: number): NavalShip | undefined;
}
const PREFIX = "relief:";
export const reliefDeliveryId = (questId: string) => `${PREFIX}${questId}`;
export const reliefQuestId = (deliveryId: string) => deliveryId.startsWith(PREFIX) ? deliveryId.slice(PREFIX.length) : undefined;

const friendlyHarbour = (building: SettlementBuilding) => building.typeId === 39 &&
  building.construction === 1 && isOwnBuilding(building);
const reachableStorages = (context: SettlementContext, harbour: SettlementBuilding) => context.buildings.filter(building =>
  storageContribution(building) > 0 && (building.uid === harbour.uid ||
    Boolean(context.options.roads.route(building.access, harbour.access))));

/** Payment belongs to one connected physical collection; stock across water is never pooled. */
export const reliefCollectionCandidates = (context: SettlementContext, ware: string) => context.buildings
  .filter(friendlyHarbour).map(harbour => ({ harbourUid: harbour.uid,
    available: tradeAvailableStock(reachableStorages(context, harbour), ware, harbour.uid) }))
  .sort((a, b) => b.available - a.available || a.harbourUid - b.harbourUid);

/** Durable paid custody, neutral visitor and final physical departure receipt. */
export const createReliefCollections = (context: SettlementContext) => {
  let state: ReliefCollectionSave = { version: 1, jobs: [] };
  const blockers = new Map<string, string>();
  const find = (questId: string) => state.jobs.find(job => job.questId === questId);
  const served = (questId: string, shipId: number) => state.jobs.find(job => job.questId === questId && job.shipId === shipId);
  const port = () => context.naval?.reliefShips;
  /** The aid is paid from the harbour's own pool: held rows (older saves) are staged without a walk. */
  const stageCollection = (job: ReliefCollectionJob) => {
    const harbour = context.buildings.find(building => building.uid === job.harbourUid && friendlyHarbour(building));
    if (!harbour) return "The paid collection harbour is no longer available";
    if (job.escrow.held.some(row => !context.buildings.some(building => building.uid === row.uid)))
      return "The paid aid storage is no longer available";
    stageHeldEscrow(job.escrow);
  };
  const prunable = (listedQuestIds: readonly string[]) => {
    const listed = new Set(listedQuestIds);
    return state.jobs.filter(job => !listed.has(job.questId) && job.departed && job.loaded === job.amount &&
      !Object.keys(job.escrow.goods).length && !Object.keys(job.escrow.staged).length && !job.escrow.held.length &&
      (job.shipId === undefined || !port()?.find(job.shipId))).map(job => job.questId);
  };
  const request = (input: ReliefCollectionRequest) => {
    if (!input || input.version !== 1 || typeof input.questId !== "string" || !input.questId.length ||
      input.questId.length > 200 || typeof input.ware !== "string" || !input.ware.length ||
      !isReliefDonationWare(input.ware) || !Number.isSafeInteger(input.amount) || input.amount < 1 || input.amount > 100_000)
      return { ok: false as const, reason: "Invalid disaster relief collection" };
    const existing = find(input.questId);
    if (existing) return existing.ware === input.ware && existing.amount === input.amount
      ? { ok: true as const, harbourUid: existing.harbourUid }
      : { ok: false as const, reason: "This relief payment already has a different manifest" };
    const candidate = reliefCollectionCandidates(context, input.ware).find(candidate => candidate.available >= input.amount &&
      (input.harbourUid === undefined || candidate.harbourUid === input.harbourUid));
    if (!candidate) return { ok: false as const, reason: "No completed harbour can collect enough reachable aid wares" };
    const harbour = context.buildings.find(building => building.uid === candidate.harbourUid)!;
    const reserved = reserveFromStorages(reachableStorages(context, harbour), { [input.ware]: input.amount }, harbour.uid, context);
    if (!reserved) return { ok: false as const, reason: "The aid wares are no longer available" };
    state.jobs.push({ version: 1, questId: input.questId, ware: input.ware, amount: input.amount,
      harbourUid: harbour.uid, loaded: 0, departed: false,
      escrow: { ...reserved, id: reliefDeliveryId(input.questId), goods: { [input.ware]: input.amount },
        purpose: "purchase", ref: input.questId } });
    return { ok: true as const, harbourUid: harbour.uid };
  };
  const schedule = () => {
    blockers.clear();
    for (const job of state.jobs) {
      if (job.departed || job.loaded) continue;
      const blocker = stageCollection(job);
      if (blocker) blockers.set(job.questId, blocker);
    }
    for (const job of state.jobs) {
      if (job.departed || job.loaded || blockers.has(job.questId)) continue;
      const collecting = !isEscrowCollected(job.escrow);
      if (job.shipId !== undefined && !port()?.find(job.shipId)) delete job.shipId;
      if (job.shipId === undefined) {
        const id = port()?.send(job.harbourUid, job.questId, collecting);
        if (id !== undefined && id !== null) job.shipId = id;
        else blockers.set(job.questId, "The relief ship is waiting for a clear sea approach");
      } else if (!collecting) port()?.ready(job.shipId);
    }
  };
  const statuses = () => state.jobs.map(job => {
    const ship = job.shipId === undefined ? undefined : port()?.find(job.shipId);
    const collecting = !job.loaded && !isEscrowCollected(job.escrow);
    let stage: "ready-to-claim" | "departing" | "loading" | "paid-awaiting-ship" = "paid-awaiting-ship";
    if (job.departed) stage = "ready-to-claim";
    else if (job.loaded) stage = "departing";
    else if (ship?.phase === "loading") stage = "loading";
    let blocker = blockers.get(job.questId);
    if (!blocker && collecting) blocker = "Carriers are bringing the paid aid to the harbour";
    else if (!blocker && ship && stage === "paid-awaiting-ship") blocker = "The relief ship is waiting for a free harbour berth";
    else if (!blocker && job.loaded && !job.departed && !ship) blocker = "The loaded relief ship's departure is not confirmed";
    return { questId: job.questId, ware: job.ware, amount: job.amount, harbourUid: job.harbourUid,
      islandSeed: context.options.world.seed, stage, loaded: job.loaded, departed: job.departed,
      blocker };
  });
  return { request, schedule, statuses, prunable,
    protectsBuilding: (uid: number) => state.jobs.some(job => !job.departed &&
      (job.harbourUid === uid || job.escrow.held.some(row => row.uid === uid &&
        Object.values(row.goods).some(units => units > 0)))),
    prune: (listedQuestIds: readonly string[]) => {
      const removed = new Set(prunable(listedQuestIds));
      state.jobs = state.jobs.filter(job => !removed.has(job.questId));
      for (const id of removed) blockers.delete(id);
      return [...removed];
    },
    pending: () => state.jobs.some(job => !job.departed),
    custodyPools: () => escrowCustodyPools(state.jobs.map(job => job.escrow)),
    repointCustody: (from: number, to: number) => repointEscrowCustody(state.jobs.map(job => job.escrow), from, to),
    candidates: (ware: string) => reliefCollectionCandidates(context, ware),
    collect: (questId: string, shipId: number, harbourUid: number): Goods | null => {
      const job = served(questId, shipId);
      return job && job.harbourUid === harbourUid && !job.loaded && isEscrowCollected(job.escrow)
        ? { [job.ware]: job.amount } : null;
    },
    loaded: (questId: string, shipId: number, cargo: Readonly<Goods>) => {
      const job = served(questId, shipId);
      if (!job || job.loaded || Object.keys(cargo).length !== 1 || cargo[job.ware] !== job.amount) return false;
      job.loaded = job.amount; job.escrow.goods = {}; job.escrow.staged = {};
      return true;
    },
    gone: (questId: string, shipId: number) => {
      const job = served(questId, shipId);
      if (job && job.loaded === job.amount) job.departed = true;
    },
    save: (): ReliefCollectionSave | undefined => state.jobs.length ? structuredClone(state) : undefined,
    restore: (saved?: ReliefCollectionSave) => { state = saved ? structuredClone(saved) : { version: 1, jobs: [] }; blockers.clear(); }
  };
};
export type ReliefCollections = ReturnType<typeof createReliefCollections>;

const validManifest = (job: unknown): job is ReliefCollectionJob => {
  if (!isSaveObject(job)) return false;
  return job.version === 1 && typeof job.questId === "string" && job.questId.length > 0 &&
    job.questId.length <= 200 && typeof job.ware === "string" && isReliefDonationWare(job.ware) &&
    isSaveInteger(job.amount, 1) && job.amount <= 100_000 && isSaveInteger(job.harbourUid) &&
    isSaveInteger(job.loaded) && [0, job.amount].includes(job.loaded) && typeof job.departed === "boolean" &&
    (!job.departed || job.loaded === job.amount) && (job.shipId === undefined || isSaveInteger(job.shipId, 1));
};

const validatePaidCustody = (job: ReliefCollectionJob): string | null => {
  const escrow = job.escrow;
  if (!isSaveObject(escrow) || escrow.id !== reliefDeliveryId(job.questId) || escrow.ref !== job.questId ||
    escrow.purpose !== "purchase" || escrow.harbourUid !== job.harbourUid || !isSaveGoods(escrow.goods) ||
    !isSaveGoods(escrow.staged) || !validTradePaidCustody(escrow.custody) || !Array.isArray(escrow.held) || !escrow.held.every(row =>
      isSaveObject(row) && isSaveInteger(row.uid) && isSaveGoods(row.goods))) return "Invalid relief paid custody";
  const onlyWare = (stock: Goods) => Object.keys(stock).every(ware => ware === job.ware);
  if (!onlyWare(escrow.goods) || !onlyWare(escrow.staged) || !escrow.held.every(row => onlyWare(row.goods)) ||
    (escrow.goods[job.ware] ?? 0) !== job.amount - job.loaded || reservedUnits(job) > job.amount - job.loaded)
    return "Relief paid custody does not match its manifest";
  return null;
};
const reservedUnits = (job: ReliefCollectionJob) => job.escrow.held.reduce((sum, row) =>
  sum + (row.goods[job.ware] ?? 0), job.escrow.staged[job.ware] ?? 0);

const validatePhysicalCustody = (job: ReliefCollectionJob, ships: readonly NavalShip[]): string | null => {
  const ship = ships.find(ship => ship.id === job.shipId);
  if (job.departed && ship) return "Departed relief collection still has a live ship";
  if (ship && ship.visitor?.relief?.questId !== job.questId) return "Relief ship identity does not match its paid collection";
  if (ship?.visitor?.relief?.tail && job.loaded !== job.amount) return "Unloaded relief cargo cannot depart";
  if (job.loaded && ship && (Object.keys(ship.cargo).length !== 1 || ship.cargo[job.ware] !== job.amount))
    return "Loaded relief ship cargo does not match its paid manifest";
  return null;
};

/** A new explicit payload version, never upgraded or guessed from an older active job. */
export const validateReliefCollectionSave = (value: unknown, ships: readonly NavalShip[] = []): string | null => {
  if (value === undefined) return ships.some(ship => ship.visitor?.relief) ? "Relief ship has no paid custody" : null;
  if (!isSaveObject(value) || value.version !== 1 || !Array.isArray(value.jobs)) return "Invalid relief collection version";
  const ids = new Set<string>();
  for (const job of value.jobs) {
    if (!validManifest(job) || ids.has(job.questId)) return "Invalid relief collection manifest";
    const problem = validatePaidCustody(job) ?? validatePhysicalCustody(job, ships);
    if (problem) return problem;
    ids.add(job.questId);
  }
  for (const ship of ships) if (ship.visitor?.relief && !(value.jobs as ReliefCollectionJob[]).some(job =>
    job.questId === ship.visitor!.relief!.questId && job.shipId === ship.id)) return "Relief ship has no matching paid collection";
  return null;
};
