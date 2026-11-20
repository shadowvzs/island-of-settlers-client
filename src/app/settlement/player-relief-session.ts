import type { DailyQuest } from "../../shared/progression/daily-quests";
import type { PlayerProgress } from "../../shared/progression/player-progress";
import { reliefQuestRecord, type ReliefQuestStatus, retainedReliefQuestIds } from "../../shared/progression/relief-quests";
import type { GameSaveV1 } from "../../shared/settlement/game-save";
import { isOwnBuilding } from "../../shared/settlement/settlement-home";
import type { SettlementSimulation } from "../../shared/settlement/settlement-simulation";
import type { ArchivedReliefCandidate, ReliefIslandPort } from "./relief-island-port";

interface PlayerReliefOptions {
  get(): PlayerProgress;
  refresh(): PlayerProgress;
  commit(progress: PlayerProgress): unknown;
  simulation(): SettlementSimulation | undefined;
  port?(): ReliefIslandPort | undefined;
  initialArchives?: readonly GameSaveV1[];
  hasArchivedHarbour?(): boolean;
  localize(text: string): string;
  preparePayment?(quest: DailyQuest): Promise<true | string>;
  isCurrent?(): boolean;
}

/** Pure saved receipts cover early boot before the archipelago runtime has been attached. */
const savedReceipts = (saves: readonly GameSaveV1[]) => saves.flatMap(save =>
  (save.settlement.reliefCollections?.jobs ?? []).map(job => {
    const ship = save.settlement.naval.fleet.ships.find(ship => ship.id === job.shipId);
    let stage: ReliefQuestStatus["stage"] = "paid-awaiting-ship";
    if (job.departed) stage = "ready-to-claim";
    else if (job.loaded) stage = "departing";
    else if (ship?.phase === "loading") stage = "loading";
    return { questId: job.questId, ware: job.ware, amount: job.amount, harbourUid: job.harbourUid,
      islandSeed: save.settlement.world.seed, loaded: job.loaded, departed: job.departed, stage,
      blocker: job.departed ? undefined : "The relief collection is waiting on its owning island" };
  }));

/** Player-wide presentation/payment over island-local physical custody. Reads never tick another island. */
export const createPlayerReliefSession = (options: PlayerReliefOptions) => {
  const paying = new Set<string>(), archived = new Map<string, readonly ArchivedReliefCandidate[]>();
  let inspecting: Promise<void> | undefined;
  const archivePort = () => options.port?.();
  const newAidBlocker = () => archivePort()?.newAidBlocker?.();
  const receipts = () => [...(archivePort()?.statuses() ?? savedReceipts(options.initialArchives ?? [])),
    ...(options.simulation()?.reliefCollections?.() ?? [])];
  const synchronize = (progress: PlayerProgress): PlayerProgress => {
    if (!progress.relief) return progress;
    const physical = receipts();
    let changed = false;
    const listed = new Set(progress.quests.map(quest => quest.id));
    const retained = progress.relief.missions.filter(mission => listed.has(mission.questId) ||
      mission.stage !== "awaiting-aid" || physical.some(receipt => receipt.questId === mission.questId));
    changed = retained.length !== progress.relief.missions.length;
    const missions = retained.map(mission => {
      if (mission.stage === "completed" || mission.stage === "returned") return mission;
      const receipt = physical.find(receipt => receipt.questId === mission.questId && receipt.ware === mission.ware &&
        receipt.amount === mission.amount && (mission.islandSeed === undefined || receipt.islandSeed === mission.islandSeed));
      if (!receipt) return mission;
      const next = { ...mission, stage: receipt.stage, loaded: receipt.loaded, departed: receipt.departed,
        islandSeed: receipt.islandSeed, harbourUid: receipt.harbourUid,
        blocker: "blocker" in receipt ? receipt.blocker : undefined };
      if (JSON.stringify(next) === JSON.stringify(mission)) return mission;
      changed = true; return next;
    });
    return changed ? { ...progress, relief: { ...progress.relief, missions } } : progress;
  };
  const context = () => ({
    reliefAvailable: Boolean(options.simulation()?.buildings().some(building => building.typeId === 39 &&
      building.construction === 1 && isOwnBuilding(building)) || options.hasArchivedHarbour?.()),
    retainedQuestIds: new Set([...retainedReliefQuestIds(options.get().relief), ...paying])
  });
  /** Explicit interaction cleanup uses the current player's list, never an archived island's old clock. */
  const prune = () => {
    const progress = options.refresh(), listed = progress.quests.map(quest => quest.id);
    const simulation = options.simulation();
    if (simulation?.reliefCollectionsToPrune?.(listed).length) simulation.pruneReliefCollections(listed);
    if (!progress.relief) return;
    const physical = receipts();
    const missions = progress.relief.missions.filter(mission => listed.includes(mission.questId) ||
      (mission.stage !== "awaiting-aid" && mission.stage !== "completed" && mission.stage !== "returned") ||
      physical.some(receipt => receipt.questId === mission.questId && (!receipt.departed ||
        mission.stage === "completed" && "closed" in receipt && receipt.closed &&
        receipt.ware === mission.ware && receipt.amount === mission.amount &&
        receipt.islandSeed === mission.islandSeed && receipt.harbourUid === mission.harbourUid)));
    if (missions.length !== progress.relief.missions.length)
      options.commit({ ...progress, relief: { ...progress.relief, missions } });
  };
  const statuses = (): Readonly<Record<string, ReliefQuestStatus>> => {
    const progress = synchronize(options.get()), ids = new Set(progress.quests.map(quest => quest.id));
    return Object.fromEntries((progress.relief?.missions ?? []).filter(mission => ids.has(mission.questId)).map(mission => {
      const local = options.simulation()?.reliefCollectionCandidates(mission.ware) ?? [];
      const remote = archived.get(mission.ware) ?? [];
      const available = Math.max(0, ...local.map(port => port.available), ...remote.map(port => port.available));
      let blocker = mission.blocker;
      const aidBlocker = mission.stage === "awaiting-aid" ? newAidBlocker() : undefined;
      if (mission.stage === "awaiting-aid" && available < mission.amount)
        blocker = "No completed harbour can collect enough reachable aid wares";
      return [mission.questId, { ...mission, available,
        payable: mission.stage === "awaiting-aid" && !aidBlocker && !paying.has(mission.questId) && available >= mission.amount,
        blocker: aidBlocker ?? blocker }];
    }));
  };
  /** Explicit bind/quest-open preparation, never launched by a summary/status read. */
  const refreshPorts = () => {
    if (inspecting) return inspecting;
    const port = archivePort();
    if (!port) return Promise.resolve();
    const wares = [...new Set(options.get().relief?.missions.filter(mission => mission.stage === "awaiting-aid")
      .map(mission => mission.ware))];
    inspecting = (async () => {
      for (const ware of wares) {
        try { archived.set(ware, await port.list(ware)); }
        catch { archived.set(ware, []); }
      }
    })().finally(() => { inspecting = undefined; });
    return inspecting;
  };
  const pay = async (id: string): Promise<true | string> => {
    if (options.isCurrent?.() === false) return options.localize("The island changed before the relief payment");
    let aidProblem = newAidBlocker();
    if (aidProblem) return options.localize(aidProblem);
    prune();
    let progress = options.refresh(), mission = reliefQuestRecord(progress.relief, id);
    if (!mission || !progress.quests.some(quest => quest.id === id && !quest.done) ||
      mission.stage !== "awaiting-aid" || paying.has(id))
      return options.localize("This relief request is already paid or unavailable");
    paying.add(id);
    try {
      const simulation = options.simulation();
      const request = { version: 1 as const, questId: id, ware: mission.ware, amount: mission.amount };
      if (options.preparePayment) {
        let prepared: true | string;
        try { prepared = await options.preparePayment(progress.quests.find(quest => quest.id === id)!); }
        catch { return options.localize("The server did not confirm the relief payment; retry without paying again"); }
        if (prepared !== true) return options.localize(prepared);
        if (options.isCurrent?.() === false) return options.localize("The island changed before the relief payment");
        progress = options.refresh(); mission = reliefQuestRecord(progress.relief, id);
        if (!mission || mission.stage !== "awaiting-aid" || mission.ware !== request.ware || mission.amount !== request.amount)
          return options.localize("This relief request changed before its payment was reserved");
      }
      aidProblem = newAidBlocker();
      if (aidProblem) return options.localize(aidProblem);
      const local = simulation?.reliefCollectionCandidates(request.ware).find(candidate => candidate.available >= request.amount);
      let result: { ok: boolean; harbourUid?: number; reason?: string }, islandSeed: number;
      if (simulation && local) {
        result = simulation.requestReliefCollection({ ...request, harbourUid: local.harbourUid });
        islandSeed = simulation.saveState().world.seed;
      } else {
        const port = archivePort();
        const candidates = port ? await port.list(request.ware) : [];
        if (options.isCurrent?.() === false) return options.localize("The island changed before the relief payment");
        aidProblem = newAidBlocker();
        if (aidProblem) return options.localize(aidProblem);
        const candidate = candidates.find(candidate => candidate.available >= request.amount);
        if (!candidate || !port) return options.localize("No completed harbour can collect enough reachable aid wares");
        progress = options.refresh(); mission = reliefQuestRecord(progress.relief, id);
        if (!mission || mission.stage !== "awaiting-aid") return options.localize("This relief request is already paid");
        result = await port.reserve(candidate, request); islandSeed = candidate.islandSeed;
      }
      if (!result.ok) return options.localize(result.reason ?? "The relief payment could not be reserved");
      if (options.isCurrent?.() === false) return true; // The archived transaction already persisted its receipt.
      progress = options.refresh();
      options.commit({ ...progress, relief: { version: 1, missions: progress.relief!.missions.map(record =>
        record.questId !== id ? record : { ...record, stage: "paid-awaiting-ship", loaded: 0, departed: false,
          islandSeed, harbourUid: result.harbourUid, blocker: undefined }) } });
      return true;
    } finally { paying.delete(id); }
  };
  return { context, pay, prune, refreshPorts, statuses, synchronize,
    status: (id: string) => statuses()[id],
    claimProblem: (id: string) => {
      const mission = statuses()[id];
      if (!mission || mission.stage === "ready-to-claim" || mission.stage === "completed") return null;
      if (mission.stage === "returned") return options.localize("This aid was returned when its collection island expired");
      return options.localize("The aid must be fully loaded and its relief ship outside the map before claiming the reward");
    }
  };
};
