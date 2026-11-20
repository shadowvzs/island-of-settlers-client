import { CHOOSE_NATION_OFFER_ID, CHOOSE_NATION_PRICE } from "../../../../island-of-settlers-shared/src/player-inventory";
import type { WorkerNation } from "../../render-common/workers/worker-unit";
import type { PlayerProgress } from "./player-progress";

export { CHOOSE_NATION_OFFER_ID, CHOOSE_NATION_PRICE };
export type { PlayerInventory, PlayerItemId } from "../../../../island-of-settlers-shared/src/player-inventory";

export const hasChooseNation = (progress: Pick<PlayerProgress, "inventory">) => progress.inventory?.chooseNation === 1;

/** One atomic local purchase; the server applies these same fixed rules under its wallet lock. */
export const purchaseChooseNation = (progress: PlayerProgress) => {
  if (hasChooseNation(progress)) return { ok: false, reason: "You already own a Choose nation item" } as const;
  if (progress.gems < CHOOSE_NATION_PRICE)
    return { ok: false, reason: `Needs ${CHOOSE_NATION_PRICE - progress.gems} more gems` } as const;
  return { ok: true, progress: { ...progress, gems: progress.gems - CHOOSE_NATION_PRICE,
    inventory: { ...progress.inventory, chooseNation: 1 as const } } } as const;
};

/** Same-nation selection is free; the application calls this only after preparing the replacement. */
export const consumeChooseNation = (progress: PlayerProgress, current: WorkerNation, next: WorkerNation) => {
  if (current === next) return progress;
  if (!hasChooseNation(progress)) return null;
  const { chooseNation: _used, ...inventory } = progress.inventory!;
  return { ...progress, inventory };
};
