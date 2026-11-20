import { banditCampPlan, isOpenArcherTower } from "../../render-common/buildings/bandit-camp-plan";
import { DMath } from "../math/deterministic-math";
import { sampleSmooth } from "../world/grid-geometry";
import { militaryHealth } from "./military-combat-rules";
import type { SettlementSoldier } from "./settlement-military";
import { isNavigationClear } from "./settlement-navigation";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "./settlement-types";

const FALL_SECONDS = 0.8;
/** Collapse releases survivors once; real walkable landing points keep them outside the solid ruin. */
export const releaseTowerArchers = (
  context: SettlementContext,
  site: SettlementBuilding,
  soldiers: Map<number, SettlementSoldier>,
  actorById: (id: number) => SettlementActor | undefined,
  includeCourtyard = false
) => {
  if (!site.bandit || (!isOpenArcherTower(site) && !includeCourtyard)) return;
  const plan = banditCampPlan(site.bandit),
    used: { x: number; z: number }[] = [];
  for (const soldier of soldiers.values()) {
    if (soldier.building !== site.uid || !soldier.combat ||
      (includeCourtyard && soldier.combat.type !== "archer")) continue;
    const body = actorById(soldier.actor);
    if (!body) continue;
    const candidates = Array.from({ length: 96 }, (_, index) => {
      const angle = ((index % 32) * Math.PI) / 16;
      const margin = 0.65 + Math.floor(index / 32) * 0.6;
      return {
        x: site.x + DMath.sin(angle) * (site.width / 2 + margin),
        z: site.z + DMath.cos(angle) * (site.depth / 2 + margin)
      };
    });
    const landing =
      candidates.find(
        (point) =>
          isNavigationClear(context, point) &&
          !used.some((previous) => DMath.hypot(previous.x - point.x, previous.z - point.z) < 0.45) &&
          !context.actors.some(
            (actor) =>
              actor.visible &&
              actor.uid !== body.uid &&
              DMath.hypot(actor.x - point.x, actor.z - point.z) < 0.35
          )
      ) ?? site.access;
    used.push(landing);
    const ground = sampleSmooth(
      context.options.world,
      context.options.world.heights,
      landing.x,
      landing.z
    );
    const fromY = Math.max(
      ground + 0.2,
      site.y + Math.max(...plan.lookouts.map((point) => point[1]))
    );
    const state = soldier.combat;
    state.hp = Math.max(
      Math.min(state.hp, 1),
      state.hp - militaryHealth(state.type, soldier.rank) * 0.25
    );
    state.towerFall = { remaining: FALL_SECONDS, fromY, groundY: ground };
    state.fallenTowerArcher = true;
    state.siege = undefined;
    state.target = undefined;
    state.pendingTarget = undefined;
    state.destination = undefined;
    state.attackTime = 0;
    state.cooldown = FALL_SECONDS + 0.4;
    soldier.stationed = false;
    soldier.building = -3;
    Object.assign(body, landing, {
      building: body.home,
      y: fromY,
      visible: true,
      phase: "militaryField",
      action: "idle",
      path: [],
      pathIndex: 0
    });
  }
};

export const updateTowerFall = (body: SettlementActor, soldier: SettlementSoldier, dt: number) => {
  const state = soldier.combat,
    fall = state?.towerFall;
  if (!fall) return false;
  const remaining = Math.max(0, fall.remaining - dt),
    progress = 1 - remaining / FALL_SECONDS;
  body.y = fall.groundY + (fall.fromY - fall.groundY) * (1 - progress * progress);
  body.action = "idle";
  state!.cooldown = Math.max(0, state!.cooldown - dt);
  state!.towerFall = remaining ? { ...fall, remaining } : undefined;
  return true;
};
