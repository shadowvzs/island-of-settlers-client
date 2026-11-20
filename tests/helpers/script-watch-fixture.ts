import { expect } from "vitest";

import type { ScriptEmission } from "../../../island-of-settlers-shared/src/script/types/emission";
import type { MapScript, ScriptEvent } from "../../../island-of-settlers-shared/src/script/types/index";
import { militaryHealth } from "../../src/shared/settlement/military-combat-rules";
import type { SettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import type { SettlementActor } from "../../src/shared/settlement/settlement-types";
import { createBalanceSimulation } from "../../tools/bench/garrison-balance-harness";
import { advance } from "./military-assault-fixture";

/** Shared scaffolding of the script watch tests (TRG4 region watch, TRG4b proximity watch). */

export const on = (kind: ScriptEvent["kind"], slots: ScriptEvent["slots"] = {}) =>
  ({ kind, player: { kind: "any" }, slots }) as ScriptEvent;

/** Every emission the engine accepts from now on, in emission order. */
export const recordEmissions = (sim: SettlementSimulation) => {
  const engine = sim.script()!.engine, emitted: ScriptEmission[] = [];
  const original = engine.emit.bind(engine);
  engine.emit = emission => { if (engine.isSubscribed(emission.kind)) emitted.push(emission); original(emission); };
  return emitted;
};

export const actorOf = (sim: SettlementSimulation, uid: number) => sim.frames().find(actor => actor.uid === uid)!;

export const tick = (sim: SettlementSimulation) => sim.update(.05);

export const teleport = (actor: SettlementActor, x: number, z: number) => Object.assign(actor, { x, z });

/** Two shield soldiers out in the open at (20, 20), the island running `script`. */
export const garrisonIsland = (script: MapScript) => {
  const sim = createBalanceSimulation(48, 123, undefined, world => { world.script = script; });
  sim.receiveTroops([1, 2].map(() => ({ hp: militaryHealth("shield", 2), rank: 2, type: "shield" })));
  const soldiers = sim.militarySoldiers().map(soldier => soldier.actor);
  expect(sim.commandMilitary(soldiers, { x: 20, z: 20 }, "move")).toBe(true);
  const outside = () => soldiers.every(uid => actorOf(sim, uid).visible);
  for (let second = 0; second < 60 && !outside(); second++) advance(sim, 1);
  expect(outside()).toBe(true);
  return { sim, soldiers };
};
