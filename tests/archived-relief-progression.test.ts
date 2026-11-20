import { buildingExperience, LEVEL_THRESHOLDS, levelUpReward } from "@shared/catalog/balance";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, it } from "vitest";

import { createSessionLifecycle } from "../src/app/session-lifecycle";
import { createArchivedIslandAccess } from "../src/app/settlement/archived-island-access";
import { runArchivedReliefNative } from "../src/app/settlement/archived-relief-native";
import { createHeadlessIsland } from "../src/app/settlement/headless-replay";
import { createArchivedPlayerProgress } from "../src/app/settlement/player-archive-progress";
import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import type { Archipelago } from "../src/shared/settlement/archipelago";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";

it("reconciles real archived construction XP, quest context, gems and owning-island level coins once", async () => {
  const source: GameSaveV1 = JSON.parse(await readFile(resolve(
    "tests/fixtures/relief-collection/awaiting.save.json"), "utf8"));
  source.player!.experience = LEVEL_THRESHOLDS[14]! - 1;
  const prepared = await createHeadlessIsland(source), footprint = getBuildingDefinition(17).gridFootprint;
  const candidates = Array.from({ length: 40 * 40 }, (_, index) => ({
    x: 12 + index % 40 + footprint[0] % 2 / 2, z: 12 + Math.floor(index / 40) + footprint[1] % 2 / 2
  })).sort((a, b) => Math.hypot(a.x - 32, a.z - 32) - Math.hypot(b.x - 32, b.z - 32));
  let buildingUid: number | undefined;
  for (const candidate of candidates) {
    const placed = prepared.simulation.placeBuilding(17, candidate.x, candidate.z);
    if (!placed.ok || !placed.building) continue;
    if (prepared.simulation.connectRoads(prepared.simulation.headquarters.access, placed.building.access)) {
      buildingUid = placed.building.uid;
      break;
    }
    prepared.simulation.demolishBuilding(placed.building.uid);
  }
  expect(buildingUid).toBeDefined();
  const baseline = await prepared.save(), beforeCoins = prepared.simulation.resourceTotal("coins");
  let progress = structuredClone(baseline.player!);
  let group = { version: 1, active: 2, home: baseline, colonies: [] } as Archipelago;
  const bridge = createArchivedPlayerProgress({ current: () => progress, commit: next => { progress = next; } });
  const writes: GameSaveV1[] = [];
  const access = createArchivedIslandAccess({ group: () => group, setGroup: next => { group = next; },
    capture: async () => baseline, player: () => progress, ...bridge, transition: createSessionLifecycle(),
    now: () => baseline.savedAt + 300_000, persist: { writeSavedGame: async save => { writes.push(save); } } });
  const result = await access.updateArchivedIsland(null, "earned-building", (save, context) =>
    runArchivedReliefNative(save, "home", () => undefined, save.savedAt + 300_000, context.questClock));
  expect(result.ok).toBe(true);
  expect(group.home!.settlement.buildings.find(building => building.uid === buildingUid)!.construction).toBe(1);
  const xp = buildingExperience(footprint), reward = levelUpReward(15);
  expect(progress.experience).toBe(baseline.player!.experience + xp);
  expect(progress.gems).toBe(baseline.player!.gems + reward.gems);
  const localCoins = group.home!.settlement.buildings.reduce((sum, building) => sum + (building.inventory.coins ?? 0), 0) +
    group.home!.settlement.storagePools.pools.reduce((sum, pool) => sum + (pool.available.coins ?? 0), 0);
  expect(localCoins).toBe(beforeCoins + reward.coins);
  expect(writes[0]!.player).toEqual(progress);
  const paidXP = progress.experience, paidGems = progress.gems;
  const again = await access.updateArchivedIsland(null, "continued", (save, context) =>
    runArchivedReliefNative(save, "home", () => undefined, save.savedAt + 1_000, context.questClock));
  expect(again.ok).toBe(true); expect(progress.experience).toBe(paidXP); expect(progress.gems).toBe(paidGems);
  expect(group.home!.settlement.buildings.reduce((sum, building) => sum + (building.inventory.coins ?? 0), 0) +
    group.home!.settlement.storagePools.pools.reduce((sum, pool) => sum + (pool.available.coins ?? 0), 0)).toBe(localCoins);
}, 30_000);
