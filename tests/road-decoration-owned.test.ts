import { expect, it } from "vitest";

import { purchasePersonalItem } from "../src/shared/progression/personal-item-purchase";
import { createPlayerProgress } from "../src/shared/progression/player-progress";
import type { Archipelago } from "../src/shared/settlement/archipelago";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import { countOwnedPlacedRoadDecorations } from "../src/shared/settlement/road-decoration-owned";

const item = "roadDecoration:indigenous-flower-pot:native";
const save = (placed: number, pending = 0) => ({ settlement: { roadDecorations: {
  placed: Array.from({ length: placed }, () => ({ item })), returns: Array.from({ length: pending }, () => ({ item }))
} } }) as unknown as GameSaveV1;

it("acquisition counts held plus placed/pending across archives, excluding the active island's stale save and duplicate receipts", () => {
  const group = { active: 1, home: save(1, 1), colonies: [{ expeditionId: 1, save: save(9) }, { expeditionId: 2, save: save(1) }],
    adventures: [{ expeditionId: 3, save: save(1, 1) }], reliefReceipts: [{ islandId: 2, save: save(7) }] } as unknown as Archipelago;
  expect(countOwnedPlacedRoadDecorations(item, [{ item }], [{ item }], group)).toBe(7);
  const progress = { ...createPlayerProgress(1), gems: 100, inventory: { [item]: 999_999 } };
  expect(purchasePersonalItem(progress, item, 1)).toMatchObject({ ok: false });
  expect(purchasePersonalItem(progress, item, 0)).toMatchObject({ ok: true, progress: { inventory: { [item]: 1_000_000 } } });
  expect(purchasePersonalItem(progress, item, Number.NaN)).toMatchObject({ ok: false });
});
