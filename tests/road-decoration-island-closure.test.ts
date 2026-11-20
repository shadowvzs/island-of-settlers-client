import { expect, it, vi } from "vitest";

import { createArchipelagoSession } from "../src/app/settlement/archipelago-session";
import { prepareIslandTravel } from "../src/app/settlement/island-travel-plan";
import { adventureOffers } from "../src/shared/settlement/adventure-rules";
import { addAdventureRecord, addColonyRecord, emptyArchipelago, endAdventure, endColony, expireColony } from "../src/shared/settlement/archipelago";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import { composeGameSave, splitGameSave } from "../src/shared/settlement/game-save-rows";
import type { SettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { createMemorySaveStore } from "./memory-save-store";

const item = "roadDecoration:indigenous-flower-pot:native";
const save = (count: number): GameSaveV1 => ({ format: "island-settlers-game", map: "flat", version: 3,
  savedAt: 10, progress: { fog: [], surveyed: [] }, settlement: { roadDecorations: {
    placed: Array.from({ length: count }, (_, uid) => ({ uid, item })), returns: [{ source: count, item }]
  } } } as unknown as GameSaveV1);
const landing = { crew: 0, landed: {}, troops: [] };
const island = { difficulty: "easy" as const, id: 2, name: "Gull Rock", ore: "coal" as const, seed: 9, voyageSeconds: 120 };
const adventure = adventureOffers(3)[0]!;

it("colony closure and active expiry retain current placed and pending items, excluding stale archive and relief proof copies", () => {
  const initial = addColonyRecord(emptyArchipelago(), 7, island, landing);
  const stale = { ...initial, colonies: initial.colonies.map(row => ({ ...row, save: save(1) })) };
  const ended = endColony(stale, 7, []);
  expect(ended.closedRoadDecorations).toEqual([{ island: "colony-7", items: { [item]: 2 } }]);
  expect(endColony(ended, 7, []).closedRoadDecorations).toEqual(ended.closedRoadDecorations);
  expect(stale.colonies).toHaveLength(1);
  const expired = expireColony(stale, { ...stale.colonies[0]!, save: save(3) }, 50);
  expect(expired.closedRoadDecorations).toEqual([{ island: "colony-7", items: { [item]: 4 } }]);
  expect(expired.colonies).toHaveLength(0);
});

it("pending closed-island returns survive session row round trips with no remaining islands abroad", () => {
  const archipelago = { ...emptyArchipelago(), closedRoadDecorations: [
    { island: "adventure-7" as const, items: { [item]: 4 } }
  ] };
  const rows = splitGameSave({ ...save(0), archipelago });
  const rebuilt = composeGameSave(rows)!;
  expect(rebuilt.archipelago?.closedRoadDecorations).toEqual(archipelago.closedRoadDecorations);
  expect(splitGameSave(rebuilt)).toEqual(rows);
});

it("finished-adventure travel queues the frozen current save only in the destination; failed staging leaves departure ownership intact", async () => {
  const initial = addAdventureRecord(emptyArchipelago(), 7, adventure, landing);
  const group = { ...initial, active: 7, home: save(0), adventures: initial.adventures!.map(row =>
    ({ ...row, status: "won" as const, save: save(1) })) };
  const current = save(4);
  const result = await prepareIslandTravel({ capture: async () => current, group: () => group, target: null,
    token: { generation: 1, current: () => true }, endIsland: async (state, id, troops) => endAdventure(state, id, troops) });
  expect((result.payload as GameSaveV1).archipelago?.closedRoadDecorations)
    .toEqual([{ island: "adventure-7", items: { [item]: 5 } }]);
  expect(result.departure.archipelago?.closedRoadDecorations).toBeUndefined();
  expect(result.departure.settlement.roadDecorations?.placed).toHaveLength(4);
  expect(group.adventures[0]!.save.settlement.roadDecorations?.placed).toHaveLength(1);
  expect(group).not.toHaveProperty("closedRoadDecorations");
});

it("session settlement retains a refused return and acknowledges an accepted batch exactly once", () => {
  let accept = false;
  const receive = vi.fn(() => accept);
  const simulation = { colonyExpeditions: () => [], colony: () => undefined, adventure: () => undefined,
    gameNow: () => 0 } as unknown as SettlementSimulation;
  // Keep an adventure active to avoid unrelated home-arrival simulation services.
  const initial = { ...addAdventureRecord(emptyArchipelago(), 7, adventure, landing), active: 7,
    home: save(0), closedRoadDecorations: [{ island: "colony-8" as const, items: { [item]: 2 } }] };
  const travel = createArchipelagoSession({ initial, simulation, capture: async () => save(0),
    store: createMemorySaveStore().store, reload: () => undefined, notify: () => undefined,
    acceptClosedRoadDecorationReturns: receive });
  expect(travel.groupForSave()?.closedRoadDecorations).toEqual(initial.closedRoadDecorations);
  accept = true;
  expect(travel.groupForSave()?.closedRoadDecorations).toBeUndefined();
  const calls = receive.mock.calls.length;
  travel.groupForSave(); travel.groupForSave();
  expect(receive).toHaveBeenCalledTimes(calls);
  travel.dispose();
});
