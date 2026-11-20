import { describe, expect, it, vi } from "vitest";

import {
  type CampaignMap, createCampaignMap
} from "../../island-of-settlers-shared/src/campaign/campaign-model";
import { createSessionLifecycle } from "../src/app/session-lifecycle";
import { createCampaignRunStart } from "../src/app/settlement/campaign-run-start";
import { createHeadlessIsland } from "../src/app/settlement/headless-replay";
import {
  campaignAttemptNumber, campaignLaunchOf, campaignRunGame, campaignShipment, campaignShippedOf
} from "../src/shared/campaign/campaign-departure-game";
import { campaignRunKey } from "../src/shared/campaign/campaign-run";
import { emptyArchipelago } from "../src/shared/settlement/archipelago";
import { HARBOUR_TYPE_ID } from "../src/shared/settlement/building-type-ids";
import { createGameSave, type GameSaveV1, readGameSave } from "../src/shared/settlement/game-save";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { createMapScenario } from "../src/shared/world/map-scenario";
import type { LoadedMap } from "../src/shared/world/save/map-reader";
import { bayHarbourPlot, bayWorld } from "./helpers/campaign-bay-world";
import { expeditionHarbourFixture } from "./helpers/colony-expedition-harbour";
import { huntingWorld } from "./helpers/hunting-world";

/** C8: a departure debits home once, starts the server attempt and boots the run's first save with home filed. */
const NOW = 1_800_000_000_000;

const campaignMap = (): CampaignMap => ({
  ...createCampaignMap("bay", "isles", { hash: null, id: "slot-1" }),
  requiredCargo: { goods: [{ amount: 12, ware: "planks" }], settlers: 3, soldiers: [{ amount: 4, type: "shield" }] },
  unlock: [{ kind: "playerLevel", level: 2 }]
});

const loadedMap = (withPlot = true): LoadedMap => {
  const world = bayWorld();
  world.scenario = { ...createMapScenario(), kind: "campaign", ...(withPlot ? { harbourPlot: bayHarbourPlot() } : {}) };
  return { animals: [], meta: { name: "Bay", savedAt: 0, source: "generated" }, terrain: null, world };
};

const homeCapture = async () => {
  const world = huntingWorld();
  let simulation: ReturnType<typeof createSettlementSimulation> | undefined;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ clockStart: NOW, initialSettlers: 5, roads, world });
  return createGameSave(world, simulation.saveState(), { animals: [], name: "Home", savedAt: NOW,
    source: "generated" });
};

const session = (patch: Partial<Parameters<typeof createCampaignRunStart>[0]> = {}) => {
  const fixture = expeditionHarbourFixture(), lifecycle = createSessionLifecycle();
  const booted: GameSaveV1[] = [], notices: string[] = [];
  const start = createCampaignRunStart({
    boot: async payload => { booted.push(payload); },
    capture: homeCapture,
    group: emptyArchipelago,
    homeOnScreen: () => true,
    now: () => NOW,
    operation: () => null,
    player: () => ({ level: 5 }) as never,
    simulation: fixture.simulation,
    travel: async (key, action) => {
      const result = await lifecycle.run({ key, run: action });
      if (!result.ok && result.reason === "failed") notices.push(String((result.error as Error).message));
      return result.ok && result.value;
    },
    ...patch
  });
  return { booted, fixture, notices, start };
};

describe("campaign run start (C8)", () => {
  it("reads the launch requirements and a never repeating attempt number", () => {
    expect(campaignLaunchOf(campaignMap())).toEqual({ cargo: campaignMap().requiredCargo, requiredLevel: 2 });
    expect(campaignLaunchOf({ requiredCargo: campaignMap().requiredCargo, soldierCap: 0, unlock: [] }))
      .toEqual({ cargo: campaignMap().requiredCargo });
    expect(campaignAttemptNumber(NOW)).toBe(1_800_000_000);
    expect(campaignAttemptNumber(0)).toBe(1);
  });

  it("trims the shipped soldiers to the map's soldier cap in cargo order and remembers what sailed", () => {
    const requiredCargo = { goods: [], settlers: 0,
      soldiers: [{ amount: 4, type: "shield" as const }, { amount: 3, type: "archer" as const },
        { amount: 2, type: "heavy" as const }] };
    expect(campaignShipment({ requiredCargo, soldierCap: 0 })).toBe(requiredCargo);
    expect(campaignShipment({ requiredCargo, soldierCap: 9 }).soldiers).toEqual(requiredCargo.soldiers);
    expect(campaignShipment({ requiredCargo, soldierCap: 5 }).soldiers)
      .toEqual([{ amount: 4, type: "shield" }, { amount: 1, type: "archer" }]);
    expect(campaignLaunchOf({ requiredCargo, soldierCap: 4, unlock: [] }).cargo.soldiers)
      .toEqual([{ amount: 4, type: "shield" }]);
    expect(campaignShippedOf(requiredCargo)).toEqual({ shippedSoldiers: requiredCargo.soldiers });
    expect(campaignShippedOf({ goods: [], settlers: 3, soldiers: [] })).toEqual({ shippedSettlers: 3 });
  });

  it("ships at most the soldier cap, with the record's victory rule in the run's start state", async () => {
    const { booted, fixture, start } = session();
    const map = { ...campaignMap(), soldierCap: 3, unlock: [], victory: { kind: "surviveTime" as const, seconds: 60 } };
    const shields = fixture.simulation.colonyTroops(fixture.harbour.uid).shield;
    expect(await start.start({ loaded: loadedMap(), map, sourceUid: fixture.harbour.uid })).toBe(true);
    expect(fixture.simulation.colonyTroops(fixture.harbour.uid).shield).toBe(shields - 3);
    expect(booted[0]!.campaignRun).toMatchObject({ shippedSettlers: 3,
      shippedSoldiers: [{ amount: 3, type: "shield" }] });
    expect(booted[0]!.settlement.campaignMap?.victory).toBeDefined();
  });

  it("debits home, keeps the server attempt and boots the run with home filed", async () => {
    const startAttempt = vi.fn(async () => ({ attemptId: "attempt-1", mapStatus: "completed" as const }));
    const { booted, fixture, notices, start } = session({ startAttempt });
    const map = campaignMap(), shields = fixture.simulation.colonyTroops(fixture.harbour.uid).shield;
    const started = await start.start({ loaded: loadedMap(), map: { ...map, unlock: [] },
      sourceUid: fixture.harbour.uid });
    expect(started, JSON.stringify(notices)).toBe(true);
    expect(startAttempt).toHaveBeenCalledWith("isles", "bay");
    expect(fixture.simulation.colonyTroops(fixture.harbour.uid).shield).toBe(shields - 4);
    const game = booted[0]!;
    expect((await readGameSave(game)).campaignRun?.mapId).toBe("bay");
    expect(game.campaignRun).toMatchObject({ attempt: 1_800_000_000, attemptId: "attempt-1", campaignId: "isles",
      mapId: "bay", mapStatus: "completed", shippedSettlers: 3, shippedSoldiers: [{ amount: 4, type: "shield" }],
      status: "running" });
    expect(game.archipelago).toMatchObject({ active: null,
      campaign: { attempt: 1_800_000_000, campaignId: "isles", mapId: "bay", runCreatedAt: NOW } });
    expect(campaignRunKey(game.archipelago!.campaign!)).toBe("campaign-bay-1800000000");
    expect(game.archipelago!.home!.archipelago).toBeUndefined();
    const island = await createHeadlessIsland(game), home = island.simulation.home()!;
    expect(home.typeId).toBe(HARBOUR_TYPE_ID);
    expect(home.inventory).toEqual({ planks: 12 });
    expect(home.idleSettlers).toBe(3);
    expect(island.simulation.islandRole()).toBe("campaign");
    expect(island.simulation.militaryStoredTroops().find(entry => entry.type === "shield")?.count).toBe(4);
    expect(island.simulation.playerNation()).toBe(fixture.simulation.playerNation());
  });

  it("starts untracked when the server is not reached and refuses on a server refusal", async () => {
    const offline = session({ startAttempt: async () => { throw new Error("offline"); } });
    const departure = { loaded: loadedMap(), map: { ...campaignMap(), unlock: [] }, sourceUid: 0 };
    expect(await offline.start.start({ ...departure, sourceUid: offline.fixture.harbour.uid })).toBe(true);
    expect(offline.booted[0]!.campaignRun!.attemptId).toBeUndefined();
    const refused = session({ startAttempt: async () => "This campaign map is not available" });
    const shields = refused.fixture.simulation.colonyTroops(refused.fixture.harbour.uid).shield;
    expect(await refused.start.start({ ...departure, sourceUid: refused.fixture.harbour.uid }))
      .toBe("This campaign map is not available");
    expect(refused.booted).toEqual([]);
    expect(refused.fixture.simulation.colonyTroops(refused.fixture.harbour.uid).shield).toBe(shields);
  });

  it("takes nothing when the gate, the slot, the map file or the island refuses", async () => {
    const gated = session({ operation: () => ({ id: 3, kind: "expedition" }) });
    const map = { ...campaignMap(), unlock: [] }, uid = gated.fixture.harbour.uid;
    const shields = gated.fixture.simulation.colonyTroops(uid).shield;
    expect(await gated.start.start({ loaded: loadedMap(), map, sourceUid: uid }))
      .toBe("Another expedition is still under way");
    const levelGated = session();
    expect(await levelGated.start.start({ loaded: loadedMap(), map: campaignMap(),
      sourceUid: levelGated.fixture.harbour.uid })).toBe("Unlocks at player level 2");
    const noPlot = session();
    expect(await noPlot.start.start({ loaded: loadedMap(false), map, sourceUid: noPlot.fixture.harbour.uid }))
      .toBe("");
    expect(noPlot.notices).toEqual(["A campaign run needs the landing harbour plot"]);
    const away = session({ homeOnScreen: () => false });
    expect(await away.start.start({ loaded: loadedMap(), map, sourceUid: away.fixture.harbour.uid }))
      .toBe("Campaigns start from the home island");
    for (const { booted, fixture } of [gated, levelGated, noPlot, away]) {
      expect(booted).toEqual([]);
      expect(fixture.simulation.colonyTroops(fixture.harbour.uid).shield).toBe(shields);
    }
  });

  it("files home without its group and refuses a save without campaign state", async () => {
    const home = await homeCapture();
    expect(() => campaignRunGame(home, emptyArchipelago(), home, NOW)).toThrow("no campaign state");
  });
});
