import { DMath } from "../math/deterministic-math";
import { emitBuildingUpgraded } from "../script-world/script-building-events";
import { addGood } from "./production-rules";
import { builderHammerContacts, constructionFacing, constructionWorkPositions } from "./settlement-construction";
import { exitPath } from "./settlement-entrance";
import { nearestStorage } from "./settlement-logistics";
import { createActor, groundPath, moveActor, setActorPath } from "./settlement-paths";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "./settlement-types";
import { returnBuilder } from "./settlement-workers";
import { canUpgradeWorkshop, finishWorkshopUpgrade, workshopUpgradeSupplied } from "./workshop-upgrades";

const WORKSHOP_UPGRADE_HITS = 24;
const isUpgradeBuilder = (actor: SettlementActor) => actor.job === "Builder" && actor.phase.startsWith("upgrade");

/** A separate builder leaves the building's production worker and cycle intact. */
export const recruitUpgradeBuilders = (context: SettlementContext) => {
  for (const building of context.buildings) {
    const upgrade = building.workshopUpgrade;
    if (!upgrade?.requested || !canUpgradeWorkshop(building) || !workshopUpgradeSupplied(building)) continue;
    if (upgrade.builder !== undefined && context.actors.some(actor =>
      actor.uid === upgrade.builder && actor.building === building.uid && isUpgradeBuilder(actor))) continue;
    upgrade.builder = undefined;
    const home = nearestStorage(context, building, "hammer", undefined, true)?.building;
    if (!home) continue;
    const route = context.options.roads.route(home.access, building.access);
    if (!route) continue;
    addGood(home.inventory, "hammer", -1);
    const actor = createActor(context, "Builder", home.uid, building.uid);
    actor.tool = "hammer";
    upgrade.builder = actor.uid;
    setActorPath(actor, [...exitPath(home), ...route.points], "upgradeAssigned");
  }
};

const releaseUpgradeBuilder = (context: SettlementContext, actor: SettlementActor, building?: SettlementBuilding) => {
  if (building?.workshopUpgrade?.builder === actor.uid) building.workshopUpgrade.builder = undefined;
  actor.job = "Settler";
  actor.action = "idle";
  actor.path = [];
  actor.pathIndex = 0;
  actor.queueTarget = undefined;
  actor.queueWait = 0;
  if (building) returnBuilder(context, actor, building);
  else {
    actor.demolitionReturning = true;
    actor.phase = "demolitionBlocked";
  }
};

const approachUpgradeWall = (context: SettlementContext, actor: SettlementActor, building: SettlementBuilding) => {
  for (const point of constructionWorkPositions(building)) {
    if (context.actors.some(other => other !== actor && other.visible &&
      DMath.hypot(other.x - point.x, other.z - point.z) < .45)) continue;
    const path = groundPath(context, actor, point);
    if (!path) continue;
    setActorPath(actor, path, "upgradeApproach");
    return;
  }
  actor.action = "idle";
  actor.timer = 1;
  actor.phase = "upgradeAccessBlocked";
};

/** Progress comes exclusively from a present builder's physical hammer contacts. */
export const updateUpgradeBuilder = (context: SettlementContext, actor: SettlementActor, dt: number) => {
  if (!isUpgradeBuilder(actor)) return false;
  const building = context.buildings.find(entry => entry.uid === actor.building);
  const upgrade = building?.workshopUpgrade;
  if (!building || !upgrade?.requested || !canUpgradeWorkshop(building) || upgrade.builder !== actor.uid) {
    releaseUpgradeBuilder(context, actor, building);
    return true;
  }
  if (actor.phase === "upgradeAccessBlocked") {
    actor.timer -= dt;
    if (actor.timer <= 0) approachUpgradeWall(context, actor, building);
    return true;
  }
  if (actor.phase === "upgradeAssigned" || actor.phase === "upgradeApproach") {
    if (!moveActor(context, actor, dt)) return true;
    if (actor.phase === "upgradeAssigned") {
      approachUpgradeWall(context, actor, building);
      return true;
    }
    actor.phase = "upgradeConstruct";
    actor.action = "idle";
    actor.visible = true;
  }
  if (!workshopUpgradeSupplied(building)) {
    actor.action = "idle";
    actor.animationTime = 0;
    return true;
  }
  const positions = constructionWorkPositions(building);
  const edge = positions.reduce((closest, point, index) =>
    DMath.hypot(point.x - actor.x, point.z - actor.z) <
    DMath.hypot(positions[closest]!.x - actor.x, positions[closest]!.z - actor.z) ? index : closest, 0);
  const point = positions[edge]!;
  if (!actor.visible || DMath.hypot(actor.x - point.x, actor.z - point.z) > .35) {
    approachUpgradeWall(context, actor, building);
    return true;
  }
  actor.yaw = constructionFacing(edge);
  if (actor.action !== "work") {
    actor.action = "work";
    actor.animationTime = 0;
    return true;
  }
  const contacts = builderHammerContacts(Math.max(0, actor.animationTime - dt), actor.animationTime);
  if (!contacts) return true;
  const progress = (upgrade.progress ?? 0) + contacts / WORKSHOP_UPGRADE_HITS;
  if (progress < 1 - 1e-8) upgrade.progress = progress;
  else if (finishWorkshopUpgrade(building)) {
    if (context.script) emitBuildingUpgraded(context, building);
    context.roadDecorations?.changedBuilding(building);
    releaseUpgradeBuilder(context, actor, building);
  }
  return true;
};
