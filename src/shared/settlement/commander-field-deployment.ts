import { militaryGroundPath } from "./military-routing";
import { commanderBlockReason, commanderMaximumHealth, type CommanderState } from "./settlement-commander";
import { doorFrontPoint, exitPath } from "./settlement-entrance";
import type { SettlementSoldier } from "./settlement-military";
import { isMountedNavigationClear } from "./settlement-navigation";
import { setActorPath } from "./settlement-paths";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "./settlement-types";

/** A normal physical exit from the lodge before control can begin. Never expose/teleport its stored actor. */
export const deployCommanderToField = (context: SettlementContext, state: CommanderState | undefined,
  soldier: SettlementSoldier | undefined, actor: SettlementActor | undefined, lodge: SettlementBuilding | undefined) => {
  if (!state || !soldier?.combat || !actor || !lodge) return { ok: false as const, reason: "Commander or lodge unavailable" };
  if (actor.visible && actor.phase === "militaryField") return { ok: true as const, actor: actor.uid };
  if (state.location !== "lodge" || actor.phase !== "commanderLodge" || actor.visible || state.transport ||
    commanderBlockReason(state, soldier.combat.hp, commanderMaximumHealth(state.level)))
    return { ok: false as const, reason: "Commander is not ready to deploy" };
  for (const distance of [2, 3, 4]) for (const side of [0, 1, -1]) {
    const goal = doorFrontPoint(lodge, distance, side);
    if (!isMountedNavigationClear(context, goal)) continue;
    const path = militaryGroundPath(context, lodge.access, goal, false);
    if (!path) continue;
    Object.assign(actor, { visible: true, mounted: false, building: lodge.uid, home: lodge.uid,
      x: lodge.doorThreshold.x, y: lodge.y, z: lodge.doorThreshold.z });
    soldier.building = -3; soldier.stationed = false;
    soldier.combat.dismounted = undefined;
    state.location = "field";
    setActorPath(actor, [...exitPath(lodge), ...path], "militaryLeaving");
    return { ok: true as const, actor: actor.uid };
  }
  return { ok: false as const, reason: "No clear mounted deployment place outside the lodge" };
};
