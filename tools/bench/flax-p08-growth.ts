import assert from "node:assert/strict";

import type { GameSaveV1 } from "../../src/shared/settlement/game-save";
import { createNaturalProgressionSession } from "./natural-progression-session";

/** Authored partial-field control: producer work upgrades must not multiply passive crop growth. */
export const measureFlaxPassiveGrowth = async (source: GameSaveV1) => {
  const values = [];
  for (const level of [0, 4]) {
    const control = structuredClone(source);
    const farm = control.settlement.buildings.find(building => building.typeId === 60)!;
    if (level) farm.workshopUpgrade = { level: 4 }; else delete farm.workshopUpgrade;
    const worker = control.settlement.actors.find(actor => actor.building === farm.uid && actor.job === "Flax grower");
    const field = control.settlement.fields.find(field => field.owner === farm.uid && field.id !== worker?.target?.id)!;
    Object.assign(field, { state: "growing", progress: .25 });
    const { sim } = await createNaturalProgressionSession(control);
    sim.setProductionPaused(farm.uid, true);
    for (let tick = 0; tick < 20; tick++) sim.update(.05);
    const after = sim.fieldFrames().find(frame => frame.id === field.id)!;
    assert.equal(after.state, "growing");
    values.push({ savedLevel: level, field: field.id, growthPerSecond: after.progress - .25 });
  }
  assert(values[0]!.growthPerSecond > 0);
  assert(Math.abs(values[0]!.growthPerSecond - values[1]!.growthPerSecond) < 1e-12,
    "Producer upgrade leaves passive field growth unchanged");
  return values;
};
