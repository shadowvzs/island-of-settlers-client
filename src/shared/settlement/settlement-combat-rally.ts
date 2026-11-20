import type { MilitaryCombatant } from "./military-combat-rules";
import type { CombatCore } from "./settlement-combat-core";

type ReturnHome = (ids: readonly number[]) => boolean;

/** Drops every trace of a march order: the place, the route waiting at the door, the pace and the siege. */
const stopMarch = (state: MilitaryCombatant) => {
  state.destination = undefined; state.order = undefined; state.pendingRoute = undefined;
  state.marchSpeed = undefined; state.rallyRunning = undefined; state.siege = undefined;
};

/**
 * Cancelling the rally banner: the player's soldiers still bound for it (queued routes not planned yet,
 * soldiers in a storage or harbour door file, soldiers marching) give up the march. Those already
 * outside go back to their storage; those still inside stay stored. `participants`: the banner's
 * siege group, which also gives up. Returns the soldiers outside with no storage to go back to.
 */
export const createCombatRallyCancel = ({
  actorById, arriving, memories, movement, pendingMarches, settling, soldiers
}: CombatCore, returnHome: ReturnHome) => {
  const rallyBound = (participants: readonly number[]) => {
    const bound = new Set(participants);
    for (const job of pendingMarches.values()) if (job.gathering) bound.add(job.uid);
    for (const [id, memory] of memories) if (memory.guardOnArrival) bound.add(id);
    return bound;
  };
  const release = (id: number, state: MilitaryCombatant) => {
    pendingMarches.delete(id);
    const memory = memories.get(id);
    if (memory) memory.guardOnArrival = undefined;
    movement.leave(id); settling.forget(id); arriving.leave(id);
    stopMarch(state);
  };
  return (participants: readonly number[] = []) => {
    const outside: number[] = [];
    for (const id of rallyBound(participants)) {
      const soldier = soldiers.get(id), actor = actorById(id);
      if (!soldier?.combat || soldier.combat.faction !== 0 || soldier.stationed || !actor) continue;
      release(id, soldier.combat);
      if (actor.phase !== "militaryReserve") outside.push(id);
    }
    if (outside.length) returnHome(outside);
    return outside.filter(id => actorById(id)?.phase === "militaryField" && !soldiers.get(id)?.combat?.returnToStorage);
  };
};
