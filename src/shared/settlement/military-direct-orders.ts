import { admitAiOrder } from "../script-world/script-order-guard";
import type { MilitaryDirectControl } from "./military-direct-control";
import type { MilitaryOrder } from "./military-targeting";
import type { CombatCore } from "./settlement-combat-core";
import type { CombatOrders } from "./settlement-combat-orders";
import type { SettlementContext, SettlementPoint } from "./settlement-types";

/**
 * Explicit player orders detach accepted escort members; internal escort/AI marches retain membership. Each
 * accepted soldier remembers the order's tick (A14-2: a fresh player order wins over a morale fall-back).
 */
export const createDirectAwareOrders = (orders: CombatOrders, control: MilitaryDirectControl,
  memoryOf: CombatCore["memoryOf"], context: SettlementContext, tick: () => number) => {
  const march = (ids: readonly number[], destination: SettlementPoint, mode: MilitaryOrder = "attackMove", gather = false) => {
    const accepted = orders.march(ids, destination, 0, mode, gather);
    for (const uid of accepted) {
      control.detach(uid);
      memoryOf(uid).orderedTick = tick();
    }
    if (gather) for (const uid of accepted) memoryOf(uid).guardOnArrival = true;
    return accepted;
  };
  return { march,
    command: (ids: readonly number[], destination: SettlementPoint, mode: MilitaryOrder = "attackMove") =>
      march(ids, destination, mode).length > 0,
    commandOpponent: (ids: readonly number[], destination: SettlementPoint, faction: number,
      mode: MilitaryOrder = "attackMove") =>
      Number.isSafeInteger(faction) && faction > 0 && orders.command(admitAiOrder(context, ids), destination, faction,
        mode)
  };
};
