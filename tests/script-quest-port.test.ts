import { buildingEntry } from "@shared/catalog";
import { expect, it } from "vitest";

import { emptyScript, quest, ref } from "../../island-of-settlers-shared/tests/script-fixtures";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { huntingWorld } from "./helpers/hunting-world";

/** TRG6 on TRG3a: a script island's book quest reads the island, pays its cost and is claimed by the engine. */
const headquarters = buildingEntry(0)!.id;

const create = () => {
  const world = huntingWorld();
  world.script = emptyScript({ quests: { ...emptyScript().quests, id: "island-book", quests: [
    quest("hq", { cost: [{ amount: 2, ware: "fish" }],
      objective: { building: ref("content", headquarters), count: 1, kind: "buildingCompleted" } }),
    quest("farms", { objective: { building: ref("content", headquarters), count: 5, kind: "buildingCompleted" } })
  ] } });
  return createSettlementSimulation({ clockStart: 0, initialSettlers: 0, roads: createRoadNetwork(world), world });
};

const claim = (questId: string, fields: object = {}) =>
  ({ bookId: "island-book", cost: {}, goods: {}, occurrence: "0", questId, skip: false, ...fields });

it("activates, completes and claims a script island's quest through the recorded claim, paying its cost", () => {
  const simulation = create();
  for (let tick = 0; tick < 25; tick++) simulation.update(.05);
  const quests = simulation.script()!.engine.state.quests;
  expect(quests.hq?.state).toBe("succeeded");
  expect(quests.farms?.state).toBe("active");
  const fish = simulation.resourceTotal("fish");
  expect(simulation.claimQuest(claim("farms"))).toBe("Finish this quest's objective first");
  expect(simulation.claimQuest(claim("hq", { goods: { coins: 5 } }))).toBe(true);
  expect(simulation.resourceTotal("fish")).toBe(fish - 2);
  expect(simulation.resourceTotal("coins")).toBeGreaterThanOrEqual(5);
  expect(simulation.script()!.engine.state.quests.hq).toMatchObject({ claimCount: 1, state: "claimed" });
  expect(simulation.claimQuest(claim("hq"))).toBe("This quest is not active");
  expect(simulation.claimQuest({ ...claim("other"), bookId: "home-default" })).toBe(true);
});
