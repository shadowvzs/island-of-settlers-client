import { addGood } from "./production-rules";
import { createDebugBuildAll } from "./settlement-debug-build-all";
import { debugRaiseBuildingLevel } from "./settlement-debug-building-level";
import { randomDebugEnemy, spawnDebugEnemy } from "./settlement-debug-enemy";
import { grantDebugHandcarts } from "./settlement-debug-handcarts";
import { grantDebugOutputs } from "./settlement-debug-outputs";
import { resetCarriers } from "./settlement-debug-reset-logistics";
import { debugPlantRoadVerges, debugUpgradeOwnedRoads } from "./settlement-debug-roads";
import { grantDebugTroop, randomDebugTroop, spawnDebugSoldier } from "./settlement-debug-troop";
import { storageDoorQueueSnapshot } from "./settlement-door-traffic";
import { doorWaitSnapshot, enableDoorWaitMetrics } from "./settlement-door-wait-metrics";
import type { createSettlementMilitary } from "./settlement-military";
import type { SettlementBuilding, SettlementContext, SettlementPoint } from "./settlement-types";
import { settlementWorkCounters } from "./settlement-work-counters";

type DebugBuildHooks = Parameters<typeof createDebugBuildAll>[1];

/** Traffic diagnostics are opt-in and expose the queue without registering or advancing turns. */
export const createSimulationTrafficDiagnostics = (context: SettlementContext) => ({
  workCounters: () => settlementWorkCounters(context),
  enableDoorWaitMetrics: () => enableDoorWaitMetrics(context),
  doorWaitMetrics: () => doorWaitSnapshot(context),
  doorQueueSnapshot: (uid: number) => storageDoorQueueSnapshot(context, uid)
});

/**
 * Development menu commands of the settlement simulation (the server rejects them in production play). Debug rolls
 * draw from the seeded, saved military stream: a replay repeats them (determinism).
 */
export const createSimulationDebugCommands = (
  context: SettlementContext, headquarters: SettlementBuilding | undefined,
  military: ReturnType<typeof createSettlementMilitary>, buildHooks: DebugBuildHooks
) => {
  const debugBuildAll = createDebugBuildAll(context, buildHooks);
  const debugBuildSearches = new Map<number, ReturnType<typeof debugBuildAll.steps>>();
  const commands = {
    /** Development menu: gold coins into the home storage. */
    grantCoins: (count: number) => {
      if (!headquarters || !Number.isSafeInteger(count) || count <= 0) return false;
      addGood(headquarters.inventory, "coins", count);
      return true;
    },
    /** Development menu: finished hand carts for the storages nearest the headquarters with room. */
    grantHandcarts: (count: number) => grantDebugHandcarts(context, count),
    /** Development menu: instantly reset land carriers and transport horses into nearby storage. */
    resetCarriers: () => resetCarriers(context),
    /** Development tool: one random enemy soldier at (or nearest reachable to) `point`. */
    spawnDebugEnemy: (point: SettlementPoint, choice = randomDebugEnemy(military.random.at("debug.enemy", -1))) =>
      spawnDebugEnemy(context, military, point, choice),
    /** Development menu: one random friendly soldier stored as a reserve in the home building. */
    grantDebugTroop: (choice = randomDebugTroop(military.random.at("debug.troop", -1))) =>
      grantDebugTroop(context, military, choice),
    /** Development tool: one random friendly field soldier at the clicked point. */
    spawnDebugSoldier: (point: SettlementPoint, choice = randomDebugTroop(military.random.at("debug.soldier", -1))) =>
      spawnDebugSoldier(military, point, choice),
    /** Development menu "Build every building": one finished, road-connected building of a type. */
    debugRaiseBuilding: debugBuildAll.build,
    debugFillOutputs: () => grantDebugOutputs(context),
    /** One snapshot-wide free tier increase, exclusively for current-map owned public roads. */
    debugUpgradeRoads: (...args: []) => {
      if (args.length) throw new Error("Road debug upgrade accepts no arguments");
      return debugUpgradeOwnedRoads(context);
    },
    /** Free Development action: plant every owned public road of this island (flowers by default). */
    debugPlantRoadVerges: (kind?: Parameters<typeof debugPlantRoadVerges>[1]) =>
      debugPlantRoadVerges(context, kind),
    /** Development tool "Raise building level": one finished upgrade level, free and immediate. */
    debugRaiseBuildingLevel: (uid: number) => debugRaiseBuildingLevel(context, uid),
    /** The same search, pausing between attempts, for spreading it over frames. */
    debugRaiseBuildingSteps: debugBuildAll.steps,
    /** One actual deterministic search advance, journalled at the time it runs. */
    debugRaiseBuildingStep: (typeId: number) => {
      let search = debugBuildSearches.get(typeId);
      if (!search) { search = debugBuildAll.steps(typeId); debugBuildSearches.set(typeId, search); }
      const step = search.next();
      if (step.done) debugBuildSearches.delete(typeId);
      return step;
    }
  };
  /** A load abandons the paused build searches. */
  return { clearSearches: () => debugBuildSearches.clear(), commands };
};
