import { beforeEach, expect, it, vi } from "vitest";

import { createGameEconomy } from "../../island-of-settlers-api/src/economy/game-economy";
import { getRoadDecorationItem, ROAD_DECORATION_ITEM_DEFINITIONS } from "../../island-of-settlers-shared/src/road-decoration-items";
import { PLANT_COMPLETION_ITEM_IDS, PLANT_COMPLETION_NATIVE_ACCEPTED, plantCompletionModelFamily }
  from "../../island-of-settlers-shared/src/road-plant-completion";

const state = vi.hoisted(() => ({ gems: 100, items: {} as Record<string, number>,
  placed: 0, ledger: [] as { gems: number; detail?: Record<string, unknown> }[], receipts: new Map<string, unknown>() }));
const db = vi.hoisted(() => ({ query: vi.fn(async (sql: string, values: unknown[]) => {
  if (!sql.startsWith("INSERT INTO economy.player_items")) throw new Error(`Unexpected purchase query: ${sql}`);
  const item = values[1] as string; state.items[item] = (state.items[item] ?? 0) + 1;
  return { rows: [], rowCount: 1 };
}) }));
vi.mock("../../island-of-settlers-api/src/economy/repository.ts", async importOriginal => ({
  ...await importOriginal<typeof import("../../island-of-settlers-api/src/economy/repository")>(),
  audit: vi.fn(), lockWallets: vi.fn(),
  transaction: async (_pool: unknown, run: (db: unknown) => Promise<unknown>) => run(db),
  wallet: async () => ({ gems: state.gems, items: { ...state.items }, goods: {}, revision: 1 }),
  receipt: async (_db: unknown, _account: string, key: string, _kind: string, _input: unknown,
    run: () => Promise<unknown>) => {
    if (state.receipts.has(key)) return state.receipts.get(key);
    const result = await run(); state.receipts.set(key, result); return result;
  }
}));
vi.mock("../../island-of-settlers-api/src/economy/ledger.ts", async importOriginal => ({
  ...await importOriginal<typeof import("../../island-of-settlers-api/src/economy/ledger")>(),
  appendLedger: async (_db: unknown, entry: { gems: number; detail?: Record<string, unknown> }) => {
    state.ledger.push(entry); state.gems += entry.gems; return true;
  }
}));
vi.mock("../../island-of-settlers-api/src/economy/road-decoration-grants.ts", async importOriginal => ({
  ...await importOriginal<typeof import("../../island-of-settlers-api/src/economy/road-decoration-grants")>(),
  placedRoadDecorationUnits: async () => state.placed
}));

const legacyApproved = [
  ...[0, 1, 2].flatMap(v => [
    `roadDecoration:plant-compact-willow-standalone-ground-${v}:native`,
    `roadDecoration:plant-columnar-cypress-roadside-ground-${v}:native`
  ]),
  ...[0, 1, 2].map(v => `roadDecoration:plant-bonsai-maple-roadside-pot-${v}:native`),
  ...["red-maple", "red-maple-yellow", "red-maple-orange"].flatMap(species =>
    [0, 1, 2].map(v => `roadDecoration:plant-${species}-standalone-ground-${v}:native`)),
  ...[0, 1, 2].map(v => `roadDecoration:plant-pink-peach-standalone-ground-${v}:native`),
  ...["ground", "pot"].flatMap(pot => [
    `roadDecoration:plant-round-boxwood-roadside-${pot}-0:native`,
    `roadDecoration:plant-round-myrtle-roadside-${pot}-1:native`,
    `roadDecoration:plant-myrtle-roadside-${pot}-2:native`
  ])
];
const approved = [...legacyApproved, ...(PLANT_COMPLETION_NATIVE_ACCEPTED ? PLANT_COMPLETION_ITEM_IDS : [])];
const completionSamples = PLANT_COMPLETION_NATIVE_ACCEPTED ? [...new Map(PLANT_COMPLETION_ITEM_IDS.map(id =>
  [plantCompletionModelFamily(getRoadDecorationItem(id)!.plant!), id])).values()] : [];
const account = "7c806ba8-bd58-405c-aa95-09d5201cd7ea";
const key = "e6157029-f5fb-4a4a-955c-357a962240cb";
const economy = () => createGameEconomy({} as Parameters<typeof createGameEconomy>[0]);
beforeEach(() => {
  state.gems = 100; state.items = {}; state.placed = 0; state.ledger.length = 0; state.receipts.clear(); db.query.mockClear();
});

it("exposes the exact accepted botanical cohort and charges one5-gem purchase on representative retries", async () => {
  const released = Object.entries(ROAD_DECORATION_ITEM_DEFINITIONS)
    .filter(([, item]) => item.plant && item.shopAvailable).map(([id]) => id).sort();
  expect(released).toEqual(approved.slice().sort());
  expect(released).toHaveLength(PLANT_COMPLETION_NATIVE_ACCEPTED ? 228 : 27);
  for (const id of [...legacyApproved, ...completionSamples]) {
    state.gems = 100; state.items = {}; state.ledger.length = 0; state.receipts.clear();
    const definition = getRoadDecorationItem(id)!;
    const api = economy();
    const first = await api.buyGemOffer(account, definition.offerId, key, "plant-purchase");
    expect(first.wallet).toMatchObject({ gems: 95, items: { [id]: 1 } });
    const again = await api.buyGemOffer(account, definition.offerId, key, "plant-purchase-retry");
    expect(again.wallet).toMatchObject({ gems: 95, items: { [id]: 1 } });
    expect(state.ledger).toHaveLength(1);
    expect(state.ledger[0]).toMatchObject({ gems: -5, detail: { offerId: definition.offerId } });
  }
});

it("refuses unapproved and unknown botanical offers without ledger or inventory mutation", async () => {
  const api = economy();
  for (const [id, item] of Object.entries(ROAD_DECORATION_ITEM_DEFINITIONS)) {
    if (!item.plant || approved.includes(id)) continue;
    expect(item.shopAvailable).toBe(false);
    await expect(api.buyGemOffer(account, item.offerId, key, "unavailable-plant")).rejects.toThrow("not available");
  }
  expect(() => api.buyGemOffer(account, "road-decoration-plant-future-tree-roadside-ground-0-native",
    key, "unknown-plant")).toThrow("Unknown gem shop offer");
  expect(state.gems).toBe(100); expect(state.items).toEqual({}); expect(state.ledger).toHaveLength(0);
  expect(db.query).not.toHaveBeenCalled();
});

it("actual server purchase counts held plus placed custody toward the existing maximum", async () => {
  const id = approved[0]!, definition = getRoadDecorationItem(id)!;
  state.items[id] = definition.maxHeld - 1; state.placed = 1;
  await expect(economy().buyGemOffer(account, definition.offerId, key, "held-plus-placed"))
    .rejects.toThrow("maximum");
  expect(state.gems).toBe(100); expect(state.ledger).toHaveLength(0); expect(db.query).not.toHaveBeenCalled();
});
