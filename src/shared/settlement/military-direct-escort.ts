import { DMath } from "../math/deterministic-math";
import type { MilitaryDirectSave } from "./military-direct-state";
import type { CombatCore } from "./settlement-combat-core";
import type { CombatOrders } from "./settlement-combat-orders";

const ESCORT_REPLANS_PER_UPDATE = 8;
const ESCORT_STALE_DISTANCE = 3;

/** Stable explicit roster, at most2 decisions/s and only after2 tiles of anchor movement. */
export const createCommanderEscort = (core: CombatCore, state: () => MilitaryDirectSave,
  march: CombatOrders["march"]) => {
  const update = (dt: number) => {
    const saved = state(), commander = core.context.commander?.soldier();
    if (!saved.roster.length) return;
    const body = commander && core.actorById(commander.actor);
    saved.roster = saved.roster.filter(id => core.soldiers.has(id));
    if (!saved.roster.length || !body?.visible || body.phase !== "militaryField" ||
      (commander?.combat?.hp ?? 0) <= 0) return;
    saved.escort.remaining = Math.max(0, saved.escort.remaining - dt);
    if (saved.escort.remaining) return;
    saved.escort.remaining = .5;
    const goal = { x: body.x - DMath.sin(body.yaw) * 2, z: body.z - DMath.cos(body.yaw) * 2 };
    const anchor = saved.escort.anchor;
    if (anchor && DMath.hypot(goal.x - anchor.x, goal.z - anchor.z) < 2) return;
    const followers = saved.roster.filter(id => {
      const soldier = core.soldiers.get(id), actor = core.actorById(id), type = soldier?.combat?.type;
      return actor?.visible && actor.phase === "militaryField" && actor.navalOrder === undefined &&
        soldier?.combat?.siege === undefined && type !== undefined && type !== "cavalry" && saved.follow[type] &&
        !core.sieges.atDoor(id) && !soldier?.combat?.attackTime && !core.pendingMarches.has(id);
    });
    if (!followers.length) return;
    const distanceToGoal = (id: number) => {
      const end = core.actorById(id)?.path.at(-1);
      return end ? DMath.hypot(end.x - goal.x, end.z - goal.z) : Infinity;
    };
    const stale = followers.filter(id => distanceToGoal(id) > ESCORT_STALE_DISTANCE)
      .sort((first, second) => distanceToGoal(second) - distanceToGoal(first) || first - second);
    const selected = stale.slice(0, ESCORT_REPLANS_PER_UPDATE);
    if (!selected.length) return;
    // Plan immediately (no per-tick queue), so followers keep walking instead of standing idle.
    march(selected, goal, 0, "attackMove", true, false);
    // A cut list leaves the old anchor: the next update continues with the remaining stale soldiers.
    if (selected.length === stale.length) saved.escort.anchor = goal;
  };
  return { update };
};
