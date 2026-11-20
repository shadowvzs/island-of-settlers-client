import { expect, it } from "vitest";

import { getSettlementUiSnapshot } from "../src/app/settlement/settlement-ui-state";
import { getWorkforceInventoryEntries } from "../src/app/settlement-ui/building-details/workforce-helpers";
import { NEUTRAL_TALENT_MODIFIERS } from "../src/shared/progression/talents";
import type { SettlementSimulation } from "../src/shared/settlement/settlement-simulation";

/** Free settlers per home uid; `undefined` asks for the whole settlement. */
const AVAILABLE_SETTLERS = new Map<number | undefined, number>([[undefined, 7], [1, 5], [2, 2]]);

it("shows a farm site's builder and missing stone while construction waits halfway", () => {
  const simulation = {
    talentModifiers: () => NEUTRAL_TALENT_MODIFIERS,
    buildingTierBlock: () => null,
    buildingAvailability: () => undefined,
    homeBuildingRules: () => undefined,
    availableSettlers: () => 69,
    population: () => ({ limit: 100, people: 70 }),
    buildings: () => [{
      uid: 1, typeId: 37, construction: .5, worker: 2,
      required: { planks: 4, stone: 3 }, input: { planks: 0 }, output: {},
      status: "Waiting for construction supplies"
    }],
    home: () => undefined,
    islandRole: () => "home",
    singleBuildingBuilt: () => false,
    handcarts: () => [],
    frames: () => [{ uid: 2, home: 0, job: "Builder", phase: "build", visible: true }],
    farmArea: () => undefined,
    fieldFrames: () => [],
    seaOrders: () => [],
    storageSnapshot: () => ({}),
    storageCollect: () => ({}),
    workshopUpgradeAvailability: () => undefined,
    harbourBerths: () => [],
    felledTreeProgress: () => undefined,
    commanderStatus: () => undefined,
    commanderRecruitStatus: () => undefined,
    stoneArea: () => undefined,
    marbleDeposits: () => [],
    shipyardMode: () => undefined,
    shipyardSite: () => undefined,
    sawmillMode: () => undefined,
    harbourShuttles: () => [],
    resourceTotal: () => 0,
    gameNow: () => 0,
    seaShippingDemands: () => [],
    seaExpeditionPreparations: () => [],
    colonyExpeditions: () => [],
    colonyTroops: () => ({}),
    militaryBuildings: () => [],
    militarySoldiers: () => [],
    militaryStoredTroops: () => [],
    tavernOrders: () => [],
    colonyIslands: () => [],
    adventureIslands: () => [],
    adventure: () => undefined,
    allowsBuilding: () => true,
    buildingLockLevel: () => null,
    offersBuilding: () => true,
    expeditionOngoing: () => false,
    featureState: () => "on",
    colony: () => undefined,
    playerNation: () => "roman",
    ships: () => [],
    bridges: () => []
  } as unknown as SettlementSimulation;
  const farm = getSettlementUiSnapshot(simulation, []).buildings![0]!;
  expect(farm.worker).toBe("Builder");
  expect(farm.input).toEqual({ planks: 0, stone: 0 });
  expect(farm.status).toBe("Waiting for construction supplies (50%)");
});

it("counts recruited roles by home until retirement and conserves the available population", () => {
  const actors = [
    { home: 1, job: "Carrier", phase: "idle", visible: false },
    { home: 1, job: "Builder", phase: "retire", visible: true },
    { home: 2, job: "Woodcutter", phase: "work", visible: false },
    { home: 2, job: "Carrier", phase: "retired", visible: false }
  ];
  const buildings = [
    { uid: 1, typeId: 0, construction: 1, inventory: { logs: 2 }, incoming: {} },
    { uid: 2, typeId: 29, construction: 1, inventory: { logs: 3 }, incoming: {} },
    { uid: 3, typeId: 29, construction: .5, inventory: { logs: 11 }, incoming: {} }
  ];
  const simulation = {
    talentModifiers: () => NEUTRAL_TALENT_MODIFIERS,
    buildingTierBlock: () => null,
    buildingAvailability: () => undefined,
    homeBuildingRules: () => undefined,
    availableSettlers: (uid?: number) => AVAILABLE_SETTLERS.get(uid) ?? 0,
    population: () => ({ limit: 100, people: 7 + actors.filter(actor => actor.phase !== "retired").length }),
    buildings: () => buildings,
    home: () => undefined,
    islandRole: () => "home",
    singleBuildingBuilt: () => false,
    handcarts: () => [],
    frames: () => actors,
    seaOrders: () => [],
    storageSnapshot: () => ({}),
    storageCollect: () => ({}),
    workshopUpgradeAvailability: () => undefined,
    harbourBerths: () => [],
    felledTreeProgress: () => undefined,
    commanderStatus: () => undefined,
    commanderRecruitStatus: () => undefined,
    stoneArea: () => undefined,
    marbleDeposits: () => [],
    shipyardMode: () => undefined,
    shipyardSite: () => undefined,
    sawmillMode: () => undefined,
    harbourShuttles: () => [],
    resourceTotal: () => 0,
    gameNow: () => 0,
    seaShippingDemands: () => [],
    seaExpeditionPreparations: () => [],
    colonyExpeditions: () => [],
    colonyTroops: () => ({}),
    militaryBuildings: () => [],
    militarySoldiers: () => [],
    militaryStoredTroops: () => [],
    tavernOrders: () => [],
    colonyIslands: () => [],
    adventureIslands: () => [],
    adventure: () => undefined,
    allowsBuilding: () => true,
    buildingLockLevel: () => null,
    offersBuilding: () => true,
    expeditionOngoing: () => false,
    featureState: () => "on",
    colony: () => undefined,
    playerNation: () => "roman",
    ships: () => [],
    bridges: () => []
  } as unknown as SettlementSimulation;
  const snapshot = getSettlementUiSnapshot(simulation, []);
  expect(snapshot.buildings?.find(building => building.id === "1")?.workforce).toEqual({
    Carrier: 1, Builder: 1
  });
  expect(snapshot.buildings?.find(building => building.id === "2")?.workforce).toEqual({ Woodcutter: 1 });
  expect(snapshot.buildings?.find(building => building.id === "3")?.workforce).toEqual({});
  expect(snapshot.availableSettlers).toBe(7);
  expect(snapshot.buildings?.find(building => building.id === "1")?.availableSettlers).toBe(5);
  expect(snapshot.buildings?.find(building => building.id === "2")?.availableSettlers).toBe(2);
  expect([snapshot.population, snapshot.populationLimit]).toEqual([10, 100]);
  expect(snapshot.resources).toEqual({ logs: 5 });
  expect(snapshot.workforce).toEqual({ Builder: 1, Carrier: 1, Woodcutter: 1 });
  expect(snapshot.militaryUnits).toEqual({ archer: 0, cavalry: 0, heavy: 0, shield: 0 });

  // A newly implemented role appears only when a real actor frame recruits it from this home.
  actors.push({ home: 2, job: "Archer", phase: "guard", visible: true });
  const recruited = getSettlementUiSnapshot(simulation, []);
  expect(recruited.buildings?.find(building => building.id === "2")?.workforce).toEqual({
    Woodcutter: 1, Archer: 1
  });
  expect(recruited.buildings?.find(building => building.id === "1")?.workforce?.Archer).toBeUndefined();
  expect(recruited.population).toBe(11);
  const secondHome = recruited.buildings!.find(building => building.id === "2")!;
  expect(getWorkforceInventoryEntries(secondHome.workforce, secondHome.availableSettlers)).toEqual([
    { job: "available", label: "Idle settlers stored here", count: 2 },
    { job: "Carrier", label: "Carriers", count: 0 },
    { job: "Woodcutter", label: "Woodcutter", count: 1 },
    { job: "Archer", label: "Archer", count: 1 }
  ]);
});
