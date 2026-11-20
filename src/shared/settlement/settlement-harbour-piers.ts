import type { ShipSiteFrame } from "../../render-common/ships/ship-frame";
import { findHarbourDock } from "./settlement-harbour-docks";
import type { ShipDestination } from "./settlement-ship-routes";
import type { SettlementBuilding, SettlementContext } from "./settlement-types";

/**
 * A harbour pier stops this far (tiles) short of its berth's hull side: a ship coming in or casting off swings
 * clear of it (NAV-02). The gangway bridges the rest while a ship lies at the berth.
 */
export { HARBOUR_GANGWAY_LENGTH } from "./settlement-harbour-pier-geometry";
/** A harbour pier's frame id: this plus twice the harbour uid plus the berth index. */
const HARBOUR_PIER_ID_OFFSET = 2_000_000;

const finishedHarbours = (context: SettlementContext) =>
  context.buildings.filter(building => building.typeId === 39 && building.construction === 1);

/** Everything the piers depend on: the world's revisions and the finished harbours with their berth level. */
const revisionKey = (context: SettlementContext, harbours: readonly SettlementBuilding[]) => {
  const { world } = context.options;
  // Piers are static harbour geometry. Occupancy/field-reservation churn (navigationRevision) does
  // not move a pier, so it must not invalidate this cache every tick on a busy island.
  return [world.buildRevision ?? 0, world.terrainRevision ?? 0, world.props.count,
    ...harbours.flatMap(harbour => [harbour.uid, harbour.workshopUpgrade?.level ?? 0])].join(":");
};

/**
 * Permanent harbour piers (owner, 2026-10-20, NAV-02): a finished harbour shows its pier at every berth,
 * whether a ship lies there or not. Display only: ships never treat it as an obstacle. Each pier is the one
 * a ship docking at that berth uses (the same berth pose and pier search), so porters and passengers keep
 * their routes. Rebuilt only when the world, the set of harbours or their upgrade levels change.
 */
export const createHarbourPiers = (
  context: SettlementContext, berthsOf: (uid: number) => readonly ShipDestination[]
) => {
  let key = "", frames: ShipSiteFrame[] = [];
  const { seaLevel } = context.options.world;
  const piersOf = (harbour: SettlementBuilding) => berthsOf(harbour.uid).flatMap((berth, index) => {
    const pose = { x: berth.x, yaw: berth.yaw ?? 0, z: berth.z };
    const work = findHarbourDock(context, harbour.uid, pose)?.workPier;
    if (!work) return [];
    return [{ ...pose, id: HARBOUR_PIER_ID_OFFSET + harbour.uid * 2 + index, kind: "pier" as const, progress: 1,
      workPier: work, y: seaLevel }];
  });
  return (): readonly ShipSiteFrame[] => {
    const harbours = finishedHarbours(context), next = revisionKey(context, harbours);
    if (next === key) return frames;
    key = next;
    frames = harbours.flatMap(piersOf);
    return frames;
  };
};
