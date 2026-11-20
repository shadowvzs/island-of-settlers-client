import { getRoadDecorationItem } from "../../../../island-of-settlers-shared/src/road-decoration-items";
import { consumePersonalItem } from "../../shared/progression/personal-item-purchase";
import type { PlayerProgress } from "../../shared/progression/player-progress";
import type { RoadDecorationCustodyPort } from "../../shared/settlement/settlement-road-decorations";
import type { SettlementSimulation } from "../../shared/settlement/settlement-simulation";

interface Options {
  active(): boolean;
  get(): PlayerProgress;
  commit(progress: PlayerProgress): unknown;
  online: boolean;
  simulation(): SettlementSimulation | undefined;
  /** Online returns require a verified save and a private server receipt. */
  requestServerReturns?: () => void;
}

/** Guest custody mutates canonical player progress. Online mutations can only use server receipts. */
export const createPlayerRoadDecorationCustody = (options: Options): RoadDecorationCustodyPort => {
  let queued = false;
  return {
    consume: item => {
      if (options.online || !options.active()) return false;
      const next = consumePersonalItem(options.get(), item);
      if (!next) return false;
      options.commit(next); return true;
    },
    receive: items => {
      if (options.online || !options.active()) return false;
      const progress = options.get(), inventory = { ...progress.inventory };
      for (const [item, amount] of Object.entries(items)) {
        const definition = getRoadDecorationItem(item);
        if (!definition || !Number.isSafeInteger(amount) || amount < 1) return false;
        const count = (inventory[item as keyof typeof inventory] ?? 0) + amount;
        if (count > definition.maxHeld) return false;
        inventory[item as keyof typeof inventory] = count;
      }
      options.commit({ ...progress, inventory }); return true;
    },
    onReturns: () => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (!options.active()) return;
        if (options.online) { options.requestServerReturns?.(); return; }
        const simulation = options.simulation();
        const ids = simulation?.pendingRoadDecorationReturns().map(row => row.id) ?? [];
        for (let offset = 0; offset < ids.length; offset += 256)
          simulation!.claimRoadDecorationReturns(ids.slice(offset, offset + 256));
      });
    }
  };
};
