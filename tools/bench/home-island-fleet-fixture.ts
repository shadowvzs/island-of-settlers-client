import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { readGameSave } from "../../src/shared/settlement/game-save";
import { claimBuilding, makeBuilding } from "../../src/shared/settlement/settlement-placement";
import type { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import type { SettlementContext, SettlementPoint } from "../../src/shared/settlement/settlement-types";
import type { WorldData } from "../../src/shared/world/world-data";
import { savedOccupancy } from "../../src/shared/settlement/save-cell-codecs";

export const HOME_FLEET_FIXTURES = resolve("../resources/project-reviews/home-island-2026-10-27/generated");
interface PlayableSite { harbour: SettlementPoint & { rotation: number } }

export const readHomeFleetFixture = async (landmasses: number) => {
  const bytes = await readFile(resolve(HOME_FLEET_FIXTURES,
    `home-map-${landmasses}-landmasses-256.save.json`), "utf8");
  const loaded = await readGameSave(JSON.parse(bytes));
  const manifest = JSON.parse(await readFile(resolve(HOME_FLEET_FIXTURES, "../manifest.json"), "utf8"));
  const record = manifest.fixtures.find((fixture: { requestedLandmasses: number }) =>
    fixture.requestedLandmasses === landmasses);
  return { loaded, save: loaded.settlement,
    sites: record.summary.world.playableSites as PlayableSite[], world: loaded.map.world };
};

/** Completed fixture harbours still own real footprints, population and unique saved identities. */
export const placeHomeFleetHarbour = (simulation: ReturnType<typeof createSettlementSimulation>,
  world: WorldData, site: PlayableSite) => {
  const state = simulation.saveState();
  const context = { ...state, occupied: savedOccupancy(state).slice(),
    options: { world } } as unknown as SettlementContext;
  const harbour = makeBuilding(context, 39, site.harbour.x, site.harbour.z, site.harbour.rotation);
  Object.assign(harbour, { construction: 1, foundationProgress: 1, idleSettlers: 10,
    inventory: { hammer: 2, planks: 200, shovel: 2, spyglass: 1, stone: 200 },
    required: {}, status: "Harbour" });
  claimBuilding(context, harbour);
  const home = context.buildings.find(building => building.typeId === 0)!;
  if ((home.idleSettlers ?? 0) < 10) throw new Error("Harbour fixture needs ten real idle settlers");
  home.idleSettlers! -= 10;
  const loaded = simulation.loadState({ ...state, buildings: context.buildings,
    nextBuilding: context.nextBuilding, occupied: Array.from(context.occupied) });
  if (!loaded.ok) throw new Error(`Completed harbour fixture did not reload: ${loaded.reason}`);
  return harbour.uid;
};
