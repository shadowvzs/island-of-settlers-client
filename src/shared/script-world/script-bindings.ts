import type { ScriptEngine } from "../../../../island-of-settlers-shared/src/script/engine/engine";
import { handleKey } from "../../../../island-of-settlers-shared/src/script/engine/values";
import type { ActorBinding } from "../../../../island-of-settlers-shared/src/script/types/run-state";
import type { MapScript } from "../../../../island-of-settlers-shared/src/script/types/script";
import type { ActorHandleValue } from "../../../../island-of-settlers-shared/src/script/types/values";
import { findAuthoredObjectHandle } from "../settlement/authored-object-uids";
import type { SettlementContext } from "../settlement/settlement-types";
import { buildingHandle, type ScriptGenerations, unitHandle } from "./script-actors";

/**
 * Authored actor bindings in `ScriptRunState.actors` (ACT2 re-scoped into TRG3a, design §6.7). A placed actor binds
 * its map-file objects through the ACT1 spawn table (map id → runtime uid) at map start; a member that is gone
 * leaves the binding and every actor variable (owner 28). Spawned actors stay empty until TRG5a's `appear`;
 * `hiddenAtStart` members are bound and hidden by the action adapter.
 */

const placedHandle = (
  context: SettlementContext, generations: ScriptGenerations, objectId: number
): ActorHandleValue | undefined => {
  const found = findAuthoredObjectHandle(context, objectId);
  if (!found) return undefined;
  if (found.space === "actor") return unitHandle(generations, found.uid);
  if (found.space === "building") return buildingHandle(found.uid);
  return { generation: 0, id: found.uid, space: "prop" };
};

/** Map start: one binding per authored actor; placed members that spawned are `alive`. */
export const bindAuthoredActors = (
  context: SettlementContext, generations: ScriptGenerations, script: MapScript
): Record<string, ActorBinding> => {
  const bindings: Record<string, ActorBinding> = {};
  for (const actor of script.actors) {
    const members = actor.binding === "placed"
      ? actor.objects.flatMap(object => placedHandle(context, generations, object.objectId) ?? [])
        .map(handle => ({ handle, scripted: false, state: "alive" as const }))
      : [];
    // Hidden at start (TRG5a): bound now and kept hidden until the first `appear` (incarnation 1 then).
    const shown = actor.binding === "placed" && !actor.hiddenAtStart && members.length > 0;
    bindings[actor.id] = { incarnation: shown ? 1 : 0, members };
  }
  return bindings;
};

const EXIT_OF_REASON = { consumed: "consumed", despawned: "disappeared", died: "died", leftMap: "leftMap" } as const;

export type ScriptGoneReason = keyof typeof EXIT_OF_REASON;

/**
 * A fully gone object: removed from its binding (a `clearOnGone` actor is unbound when its last member leaves)
 * and from every actor variable. Returns whether any script state referenced it.
 */
export const releaseGoneHandle = (engine: ScriptEngine, handle: ActorHandleValue, reason: ScriptGoneReason) => {
  const key = handleKey(handle);
  let bound = false;
  for (const actor of engine.script.actors) {
    const binding = engine.state.actors[actor.id];
    const index = binding?.members.findIndex(member => handleKey(member.handle) === key) ?? -1;
    if (!binding || index < 0) continue;
    bound = true;
    binding.members.splice(index, 1);
    if (binding.members.length) continue;
    binding.lastExit = EXIT_OF_REASON[reason];
    if (actor.lifetime === "clearOnGone") delete engine.state.actors[actor.id];
  }
  const inVariables = engine.releaseHandle(handle).length > 0;
  if (bound) engine.rebuildInstanceIndex();
  return bound || inVariables;
};
