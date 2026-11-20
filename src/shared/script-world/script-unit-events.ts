import type { ScriptEventKind } from "../../../../island-of-settlers-shared/src/script/catalog/events";
import type { ScriptEventActor } from "../../../../island-of-settlers-shared/src/script/types/emission";
import type { ActorHandleValue } from "../../../../island-of-settlers-shared/src/script/types/values";
import { ownerOf } from "../settlement/settlement-ownership";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "../settlement/settlement-types";
import { describeBuilding, describeUnit, findUnit } from "./script-actors";
import type { ScriptGoneReason } from "./script-bindings";

/**
 * Unit emission sites (design §5.1.2, TRG3a). Every helper starts with the subscription bit test, so a map without
 * a script pays one optional-chain read and a script that does not listen pays one array read; payloads are built
 * only for subscribed kinds. Call them before the simulation removes the object they describe.
 */

/** The island's script when it listens to `kind` (live mode only), else undefined. */
export const listening = (context: SettlementContext, kind: ScriptEventKind) => {
  const script = context.script;
  return script?.isSubscribed(kind) ? script : undefined;
};

const describe = (context: SettlementContext, actor: SettlementActor | undefined) =>
  actor && context.script && describeUnit(context, context.script.generations, actor);

const number = (value: number) => ({ type: "number" as const, value });

/** Who struck: a soldier or civilian uid, or a building (catapult tower); absent for environmental harm. */
export type ScriptDamageSource =
  | { actor: SettlementActor; kind: "unit" }
  | { building: SettlementBuilding; kind: "building" };

/** A striking unit as a damage source (undefined when its body is already gone). */
export const unitSource = (actor: SettlementActor | undefined): ScriptDamageSource | undefined =>
  actor && { actor, kind: "unit" };

/** The attacker as an event actor (a removed unit or building has none). */
export const describeDamageSource = (context: SettlementContext, source: ScriptDamageSource | undefined) => {
  if (!source) return undefined;
  if (source.kind === "building") return describeBuilding(context, source.building);
  return describe(context, source.actor);
};

/** Health lost: `percent` carries the health after the blow and `percentBefore` the health before it. */
export const emitUnitDamaged = (
  context: SettlementContext, victim: SettlementActor | undefined, source: ScriptDamageSource | undefined,
  health: { after: number; before: number; maximum: number }
) => {
  if (!listening(context, "actorDamaged")) return;
  const subject = describe(context, victim);
  if (!subject || health.maximum <= 0) return;
  const attacker = describeDamageSource(context, source);
  context.script!.emit({
    actors: attacker ? { source: attacker, subject } : { subject }, kind: "actorDamaged", player: subject.owner,
    responses: {
      amount: number(health.before - health.after), triggeringActor: subject.handle,
      ...(attacker ? { killingActor: attacker.handle } : {})
    },
    values: { percent: health.after / health.maximum * 100, percentBefore: health.before / health.maximum * 100 }
  });
};

/** A unit dies: "killed" with its killer when known, then "gone" (died) and the binding clean-up. */
export const emitUnitKilled = (
  context: SettlementContext, victim: SettlementActor | undefined, source: ScriptDamageSource | undefined
) => {
  const script = context.script;
  if (!script || !victim) return;
  const subject = describe(context, victim);
  if (subject && script.isSubscribed("actorKilled")) {
    const killer = describeDamageSource(context, source);
    script.emit({
      actors: killer ? { killer, victim: subject } : { victim: subject }, kind: "actorKilled", player: subject.owner,
      responses: { triggeringActor: subject.handle, ...(killer ? { killingActor: killer.handle } : {}) }
    });
  }
  emitUnitGone(context, victim, "died", subject);
};

/** A unit leaves the world (died, back into the idle pool, sailed off): "gone" and the clean-up. */
export const emitUnitGone = (
  context: SettlementContext, actor: SettlementActor, reason: ScriptGoneReason,
  described: ScriptEventActor | undefined = describe(context, actor)
) => {
  const script = context.script;
  if (!script || !described) return;
  if (script.isSubscribed("actorGone")) {
    script.emit({
      actors: { subject: described }, kind: "actorGone", player: described.owner,
      responses: { outcome: { type: "string", value: reason }, triggeringActor: described.handle },
      values: { reason }
    });
  }
  script.gone(described.handle, reason, described);
};

/** A settler goes back into its storage's idle pool: gone, and its uid's next use is another person. */
export const retireScriptUnit = (context: SettlementContext, actor: SettlementActor) => {
  if (!context.script) return;
  emitUnitGone(context, actor, "despawned");
  context.script.retireUnit(actor.uid);
};

/** A new unit appeared in the world (recruit, worker leaving storage, immigrant). */
export const emitUnitAppeared = (context: SettlementContext, actor: SettlementActor) => {
  if (!listening(context, "actorAppeared")) return;
  const subject = describe(context, actor);
  if (!subject) return;
  context.script!.emit({
    actors: { subject }, kind: "actorAppeared", player: subject.owner, responses: { triggeringActor: subject.handle }
  });
};

const unitWithBuilding = (
  context: SettlementContext, kind: ScriptEventKind, slot: string, actor: SettlementActor,
  building: SettlementBuilding | undefined, values?: Record<string, string>
) => {
  if (!listening(context, kind)) return;
  const subject = describe(context, actor);
  if (!subject) return;
  const site = building && describeBuilding(context, building);
  const responses: Record<string, ActorHandleValue | { type: "string"; value: string }> =
    { triggeringActor: subject.handle };
  if (site) responses.building = site.handle;
  if (values?.ware) responses.ware = { type: "string", value: values.ware };
  context.script!.emit({
    actors: site ? { [slot]: subject, building: site } : { [slot]: subject }, kind, player: subject.owner,
    responses, ...(values ? { values } : {})
  });
};

/** A soldier enlisted at a Tavern or a storage (its troop type is the soldier actor's catalog type). */
export const emitSoldierRecruited = (
  context: SettlementContext, actor: SettlementActor, building: SettlementBuilding | undefined
) => unitWithBuilding(context, "soldierRecruited", "soldier", actor, building);

/** A soldier of any faction rose to `rank`. */
export const emitSoldierPromoted = (context: SettlementContext, soldierUid: number, rank: number) => {
  if (!listening(context, "soldierPromoted")) return;
  const subject = describe(context, findUnit(context, soldierUid));
  if (!subject) return;
  context.script!.emit({
    actors: { soldier: subject }, kind: "soldierPromoted", player: subject.owner,
    responses: { amount: number(rank), triggeringActor: subject.handle }, values: { rank }
  });
};

/** A settler was born into the idle pool of `home` (no unit yet: the event names the storage). */
export const emitSettlerBorn = (context: SettlementContext, home: SettlementBuilding) => {
  if (!listening(context, "settlerBorn")) return;
  const site = describeBuilding(context, home);
  context.script!.emit({ kind: "settlerBorn", player: ownerOf(home),
    responses: site ? { building: site.handle } : {} });
};

/** A settler left storage for a job at `building`, with the tool it took. */
export const emitJobAssigned = (
  context: SettlementContext, actor: SettlementActor, building: SettlementBuilding, tool: string | undefined
) => {
  unitWithBuilding(context, "jobAssigned", "settler", actor, building);
  if (tool) emitToolReceived(context, actor, tool);
};

/** A settler received a tool ware from storage. */
export const emitToolReceived = (context: SettlementContext, actor: SettlementActor, tool: string) =>
  unitWithBuilding(context, "toolReceived", "settler", actor, undefined, { ware: tool });

/** An island-level outcome without actors (colony conquered or defeated), owned by the player. */
export const emitIslandEvent = (context: SettlementContext, kind: "colonyConquered" | "colonyDefeated") => {
  if (listening(context, kind)) context.script!.emit({ kind, player: 0 });
};
