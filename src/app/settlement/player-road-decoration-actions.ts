import type { RoadDecorationAction } from "../../../../island-of-settlers-shared/src/road-decoration-custody";
import type { PlayerProgress } from "../../shared/progression/player-progress";
import type { SettlementSimulation } from "../../shared/settlement/settlement-simulation";
import type { PlayerRoadDecorationResult } from "./road-decoration-session";

interface Options {
  active(): boolean;
  busy(): boolean;
  setBusy(value: boolean): void;
  onIdle?(): void;
  get(): PlayerProgress;
  commit(progress: PlayerProgress): unknown;
  online: boolean;
  mutate?: (action: RoadDecorationAction) => Promise<PlayerRoadDecorationResult>;
  simulation(): SettlementSimulation | undefined;
}
export const createPlayerRoadDecorationActions = (options: Options) => async (action: RoadDecorationAction): Promise<true | string> => {
  if (!options.active() || options.busy()) return "Another inventory action is in progress";
  const simulation = options.simulation();
  if (!simulation) return "The island is not active";
  options.setBusy(true);
  try {
    if (options.online) {
      if (!options.mutate) return "Road decoration custody is unavailable";
      const result = await options.mutate(action);
      if (!result.ok) return result.reason;
      if (!options.active()) return "The island is no longer active";
      options.commit({ ...options.get(), gems: result.gems, inventory: result.items }); return true;
    }
    if (action.kind === "place") {
      const result = simulation.placeRoadDecoration(action.order); return result.ok ? true : result.reason;
    }
    if (action.kind === "rotate") {
      const result = simulation.rotateRoadDecoration(action.uid); return result.ok ? true : result.reason;
    }
    if (action.kind === "move") {
      const result = simulation.moveRoadDecoration(action.uid, action.position, action.yaw);
      return result.ok ? true : result.reason;
    }
    if (action.kind === "pick-up") { simulation.pickUpRoadDecoration(action.uid); return true; }
    simulation.claimRoadDecorationReturns(action.ids); return true;
  } finally { options.setBusy(false); options.onIdle?.(); }
};
