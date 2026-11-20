import { setupI18n } from "@lingui/core";
import { expect, it } from "vitest";

import { getSettlementUiSnapshot } from "../src/app/settlement/settlement-ui-state";
import { translateDomainText } from "../src/shared/i18n/domain";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { hashSettlementState } from "../src/shared/settlement/settlement-state-hash";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const world = () => {
  const size = 40;
  return {
    seed: 9, cellsX: size, cellsZ: size, seaLevel: -1, start: { x: 5.5, z: 5.5 },
    heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
    fog: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    oreAmount: new Uint8Array(size ** 2), mineZone: new Uint16Array(size ** 2), mineZones: [],
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(),
      phase: new Uint8Array(), scale: new Float32Array() }
  } as unknown as WorldData;
};

const simulate = () => {
  const map = world();
  const simulation = createSettlementSimulation({
    world: map, roads: createRoadNetwork(map, { isBlocked: (x, z) => simulation.isOccupied(x, z) }),
    initialSettlers: 30, initialStock: { grain: 12, logs: 24, planks: 48, stone: 48 }, canWorkerEnterPlot: () => true
  });
  return { map, simulation };
};

const hash = ({ map, simulation }: ReturnType<typeof simulate>) =>
  hashSettlementState({ settlement: simulation.saveState(), world: map });

it("displaying domain statuses in another locale never changes simulation state", () => {
  const plain = simulate(), localized = simulate();
  const i18n = setupI18n({ locale: "hu", messages: { hu: {
    "domain.status.headquarters": "Főhadiszállás",
    "domain.status.waitingInputs": "Alapanyagokra vár"
  } } });
  for (let tick = 0; tick < 400; tick++) {
    plain.simulation.update(.05);
    localized.simulation.update(.05);
    for (const building of localized.simulation.buildings())
      if (building.status) translateDomainText(building.status, i18n);
  }
  expect(hash(localized)).toBe(hash(plain));
  expect(localized.simulation.saveState()).toEqual(plain.simulation.saveState());
  expect(localized.simulation.headquarters.status).toBe("Headquarters");
  const snapshot = getSettlementUiSnapshot(localized.simulation, [], undefined, i18n);
  expect(snapshot.buildings?.find(building => building.type === 0)?.status).toBe("Főhadiszállás");
});
