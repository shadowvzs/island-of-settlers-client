import { TROOP_GANGWAY_BOARDING_PHASES } from "./constants";
import { commanderHarbourMusterPoint } from "./settlement-commander-transport";
import type { SettlementActor, SettlementBuilding, SettlementContext, SettlementPoint } from "./settlement-types";
import { bringsHorseAboard } from "./ship-troop-horse";

/**
 * The commander free to take an own troop ship on this island (2026-11-17): out in the field, on no voyage, alive,
 * with his horse: riding it, or leading it on foot until a horse can be ridden on (`mountOnClear`). A horse left
 * waiting elsewhere (a manual dismount) keeps him ashore. He boards at a harbour pier or a gangway leading it.
 */
export const isFieldCommander = (context: SettlementContext, actor: SettlementActor) => {
  if (actor.job !== "Soldier" || actor.navalOrder !== undefined || !actor.visible ||
    !TROOP_GANGWAY_BOARDING_PHASES.includes(actor.phase) || !bringsHorseAboard(context, actor.uid)) return false;
  const combat = context.military?.soldierOf?.(actor.uid)?.combat;
  if (context.military?.factionOf?.(actor.uid) !== 0 || !combat || combat.hp <= 0) return false;
  return actor.mounted === true ? !combat.dismounted : combat.mountOnClear === true;
};

/** Each harbour's commander waiting place, kept while the navigation does not change. */
const waitingPlaces = new WeakMap<SettlementContext, Map<number, { point: SettlementPoint; revision: string }>>();

/**
 * Where the commander waits mounted beside a harbour for his turn on the pier: its off-road muster place (clear of
 * the door lane, room for a horse all round), else its access.
 */
export const commanderPierWaitingPoint = (context: SettlementContext, harbour: SettlementBuilding) => {
  let places = waitingPlaces.get(context);
  if (!places) { places = new Map(); waitingPlaces.set(context, places); }
  const revision = `${context.navigationRevision ?? 0}:${context.options.world.buildRevision ?? 0}`;
  const known = places.get(harbour.uid);
  if (known?.revision === revision) return known.point;
  const point = commanderHarbourMusterPoint(context, harbour) ?? harbour.access;
  places.set(harbour.uid, { point, revision });
  return point;
};
