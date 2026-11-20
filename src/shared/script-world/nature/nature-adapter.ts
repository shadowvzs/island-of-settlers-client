import type { ScriptEventKind } from "../../../../../island-of-settlers-shared/src/script/catalog/events";
import type { ScriptEngine } from "../../../../../island-of-settlers-shared/src/script/engine/engine";
import type {
  ScriptEmission, ScriptEventActor
} from "../../../../../island-of-settlers-shared/src/script/types/emission";
import type { SettlementContext } from "../../settlement/settlement-types";
import type { CellWatch } from "../cell-watch";
import { releaseGoneHandle, type ScriptGoneReason } from "../script-bindings";
import {
  bumpGeneration, describeAnimal, type NatureGenerations, natureHandle, type NatureSpace
} from "./nature-actors";
import { emitTreeStage } from "./nature-events";
import { regionBounds, wildlifeRegions } from "./wildlife-pins";

/**
 * The script adapter's nature part (TRG3b): gone nature objects (event, region leave, binding clean-up, generation
 * bump), hunter kills, and the island's nature source wiring (listener + wildlife pins). Generations advance in
 * every mode, catch-up included, so an old handle is gone after catch-up too; events and clean-up are live only.
 */

interface NatureAdapterHost {
  cells: () => CellWatch | undefined;
  emit: (emission: ScriptEmission) => void;
  engine: ScriptEngine;
  generations: NatureGenerations;
  isSubscribed: (kind: ScriptEventKind) => boolean;
}

export const createNatureAdapter = (context: SettlementContext, host: NatureAdapterHost) => {
  const { emit, engine, generations, isSubscribed } = host;
  /** The hunter whose arrow is in flight at `slot` (its kill is announced before the animal is gone). */
  let shot: { hunter: ScriptEventActor | undefined; slot: number } | undefined;

  const natureGone = (space: NatureSpace, id: number, reason: ScriptGoneReason, described?: ScriptEventActor) => {
    if (described && isSubscribed("actorGone")) {
      emit({
        actors: { subject: described }, kind: "actorGone", player: null,
        responses: { outcome: { type: "string", value: reason }, triggeringActor: described.handle },
        values: { reason }
      });
    }
    if (space === "animal") host.cells()?.forgetAnimal(id, described);
    if (engine.mode === "live") releaseGoneHandle(engine, natureHandle(generations, space, id), reason);
    bumpGeneration(generations, space, id);
  };
  const announceKill = (victim: ScriptEventActor, killer: ScriptEventActor | undefined) => {
    if (!isSubscribed("animalKilled")) return;
    emit({
      actors: killer ? { killer, victim } : { victim }, kind: "animalKilled", player: killer?.owner ?? null,
      responses: { targetActor: victim.handle, ...(killer ? { killingActor: killer.handle } : {}) }
    });
  };
  const animalRemoved = (slot: number) => {
    const wildlife = context.options.scriptNature?.wildlife;
    if (!wildlife) return;
    const animal = describeAnimal(wildlife, generations, slot);
    const died = wildlife.isCarcass(slot);
    if (animal && died && shot?.slot === slot) announceKill(animal, shot.hunter);
    natureGone("animal", slot, died ? "died" : "despawned", animal);
  };
  /** The island's source hears this script, and the regions its animal events name stay awake. */
  const attach = () => {
    const source = context.options.scriptNature;
    if (!source) return;
    source.listen({ animalRemoved, treeStage: (prop, stage) => emitTreeStage(context, prop, stage) });
    const { cellsX, cellsZ } = context.options.world;
    source.pinWildlife(regionBounds(wildlifeRegions(engine.script), cellsX, cellsZ));
  };
  return {
    attach,
    /** A hunter's arrow: an animal it kills is announced as killed by `hunter` before it is gone. */
    huntWith: (slot: number, hunter: ScriptEventActor | undefined, hit: () => boolean) => {
      shot = { hunter, slot };
      try { return hit(); } finally { shot = undefined; }
    },
    natureGone
  };
};

/** An island without a script: its nature source hears nobody and pins nothing. */
export const detachNature = (context: SettlementContext) => {
  const source = context.options.scriptNature;
  source?.listen(undefined);
  source?.pinWildlife([]);
};
