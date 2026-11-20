import { sampleSmooth } from "../world/grid-geometry";
import { bumpBuildRevision } from "../world/save/world-change-journal";
import { BuildingType } from "./building-type-ids";
import { STORAGE_IDS } from "./production-rules";
import type { RoadPoint } from "./road-types";
import { indexBuilding, unindexBuilding } from "./settlement-building-index";
import { removeSettlementBuilding } from "./settlement-demolition";
import { findFactionHome } from "./settlement-home";
import { ownerOf, PLAYER_FACTION, servesEconomyOf } from "./settlement-ownership";
import { bumpNavigationRevision } from "./settlement-reservations";
import type { SettlementBuilding, SettlementContext } from "./settlement-types";

/** Inert construction shell: the Well definition supplies sane stock/access data, never a model. */
const ROAD_WORK_SHELL_TYPE_ID = BuildingType.Well;

/** Completed storages serving the economy of `owner`, the faction ordering the road work. */
export const storageBuildings = (context: SettlementContext, owner = PLAYER_FACTION) =>
  context.buildings.filter(building => building.construction === 1 && STORAGE_IDS.has(building.typeId) &&
    servesEconomyOf(context, building, owner));

export const stockReachable = (context: SettlementContext, point: RoadPoint, owner = PLAYER_FACTION) =>
  storageBuildings(context, owner).some(building =>
    context.options.roads.route(building.access, point) !== null);

export interface RoadWorkShellOrder {
  /** Road node carriers deliver to and the builder starts from. */
  anchor: RoadPoint;
  required: Record<string, number>;
  status: string;
  /** Where the hidden stock is kept and the builder works. */
  stockPoint: RoadPoint;
  work: Pick<SettlementBuilding, "bridgeSite" | "vergeSite">;
}

/**
 * Hidden builder shell of one road work order (a bridge span, an upgrade or a verge stretch):
 * carriers deliver `required` to it and builders work it; it never enters the building list the UI
 * and renderer show.
 */
export const createRoadWorkShell = (context: SettlementContext, order: RoadWorkShellOrder) => {
  const { world } = context.options;
  const { anchor, stockPoint } = order;
  const building: SettlementBuilding = {
    uid: context.nextBuilding++,
    typeId: ROAD_WORK_SHELL_TYPE_ID,
    x: stockPoint.x,
    z: stockPoint.z,
    y: sampleSmooth(world, world.heights, stockPoint.x, stockPoint.z),
    rotation: 0,
    width: 1,
    depth: 1,
    access: { ...anchor },
    workerApproach: { ...anchor },
    doorThreshold: { ...anchor },
    hasDoor: false,
    construction: 0,
    foundationProgress: 1,
    working: false,
    door: 0,
    status: order.status,
    input: {},
    output: {},
    inventory: {},
    incoming: {},
    required: order.required,
    accepts: {},
    selected: false,
    cycle: 0,
    ...order.work
  };
  context.buildings.push(building);
  indexBuilding(context, building);
  bumpNavigationRevision(context);
  bumpBuildRevision(world, null);
  return building;
};

/** Uses the existing construction refund: delivered stock returns to storage, consumed work does not. */
export const removeRoadWorkShell = (context: SettlementContext, site: SettlementBuilding) => {
  if (findFactionHome(context, ownerOf(site))) {
    removeSettlementBuilding(context, site);
    return;
  }
  // Building-free fixtures cannot hold a road crew; remove the shell without displacing anyone.
  for (const actor of context.actors) if (actor.building === site.uid) actor.building = actor.home;
  const index = context.buildings.indexOf(site);
  if (index >= 0) context.buildings.splice(index, 1);
  unindexBuilding(context, site);
  bumpNavigationRevision(context);
};
