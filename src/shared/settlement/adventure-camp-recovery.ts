import { DMath } from "../math/deterministic-math";
import { sampleSmooth } from "../world/grid-geometry";
import { adventureCampNavigationIndex } from "./adventure-camp-navigation";
import { CAMP_FOOT_CLEARANCE, CAMP_MOUNTED_CLEARANCE,campPointIsClear } from "./adventure-camp-obstacles";
import { isMountedNavigationClear, isNavigationClear } from "./settlement-navigation";
import type { SettlementContext, SettlementPoint } from "./settlement-types";

/** Old presentation-only saves may put a body inside a now-solid tent. Resolve once on restore. */
export const recoverCampOverlaps = (context: SettlementContext) => {
  const index = adventureCampNavigationIndex(context);
  if (!index.obstacles.length) return;
  for (const actor of context.actors) {
    if (!actor.visible) continue;
    const radius = actor.mounted ? CAMP_MOUNTED_CLEARANCE : CAMP_FOOT_CLEARANCE;
    if (campPointIsClear(index, actor, radius)) continue;
    const clear = (point: SettlementPoint) => actor.mounted ? isMountedNavigationClear(context, point) : isNavigationClear(context, point);
    let recovered: SettlementPoint | undefined;
    for (let ring = 1; ring <= 24 && !recovered; ring++) for (let direction = 0; direction < 32; direction++) {
      const angle = direction * Math.PI / 16;
      const point = { x: actor.x + DMath.cos(angle) * ring * .25, z: actor.z + DMath.sin(angle) * ring * .25 };
      if (clear(point)) { recovered = point; break; }
    }
    if (!recovered) continue;
    actor.x = recovered.x; actor.z = recovered.z;
    actor.y = sampleSmooth(context.options.world, context.options.world.heights, actor.x, actor.z);
    while (actor.pathIndex < actor.path.length && !clear(actor.path[actor.pathIndex]!)) actor.pathIndex++;
  }
};
