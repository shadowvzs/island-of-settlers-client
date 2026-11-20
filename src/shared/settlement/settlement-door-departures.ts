import { actorIncarnation } from "./actor-incarnation";
import { createTransientMap } from "./settlement-transient-state";
import type { SettlementActor, SettlementContext } from "./settlement-types";

type Departure = { actor: SettlementActor; identity: object; phase: string; home: number; delivery: SettlementActor["delivery"]; since: number };
const requests = createTransientMap<Map<number, Departure[]>>();
/** Transient door requests belong to a particular job/person, never to a recycled actor shell. */
export const pendingStorageDepartures = (context: SettlementContext, uid: number) => {
  let buildings = requests.get(context);
  if (!buildings) { buildings = new Map(); requests.set(context, buildings); }
  const pending = (buildings.get(uid) ?? []).filter(({ actor, delivery, home, identity, phase }) =>
    !actor.visible && actor.phase === phase && actor.home === home && actor.delivery === delivery && actorIncarnation(actor) === identity && context.actors.includes(actor));
  buildings.set(uid, pending);
  return pending;
};
export const requestStorageDeparture = (context: SettlementContext, uid: number, actor: SettlementActor, now: number) => {
  const pending = pendingStorageDepartures(context, uid), existing = pending.find((request) => request.actor === actor);
  if (existing) return { created: false, since: existing.since };
  pending.push({ actor, identity: actorIncarnation(actor), phase: actor.phase, home: actor.home, delivery: actor.delivery, since: now });
  return { created: true, since: now };
};

export interface SavedStorageDeparture { building: number; actor: number; phase: string; home: number; since: number }
export const saveStorageDepartures = (context: SettlementContext): SavedStorageDeparture[] =>
  [...requests.get(context) ?? []].flatMap(([building, list]) => list.filter(request =>
    !request.actor.visible && request.actor.phase === request.phase && request.actor.home === request.home &&
    request.actor.delivery === request.delivery && actorIncarnation(request.actor) === request.identity &&
    context.actors.includes(request.actor)).map(request => ({ building, actor: request.actor.uid,
      phase: request.phase, home: request.home, since: request.since })));
export const restoreStorageDepartures = (context: SettlementContext, saved: readonly SavedStorageDeparture[]) => {
  const held = new Map<number, Departure[]>(); requests.set(context, held);
  for (const value of saved) {
    const actor = context.actors.find(unit => unit.uid === value.actor);
    if (!actor) continue;
    const list = held.get(value.building) ?? [];
    list.push({ actor, identity: actorIncarnation(actor), phase: value.phase, home: value.home,
      delivery: actor.delivery, since: value.since }); held.set(value.building, list);
  }
};
