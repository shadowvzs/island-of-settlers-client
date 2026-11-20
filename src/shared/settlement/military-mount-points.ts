import { DMath } from "../math/deterministic-math";
import { restoreEntries, saveEntries, type SavedEntries } from "./military-field-save";
import { isMountedNavigationClear } from "./settlement-navigation";
import { groundPath } from "./settlement-paths";
import type { SettlementActor, SettlementBuilding, SettlementContext, SettlementPoint } from "./settlement-types";

/** A rider's mounting place and its age (seconds); saved, so a load keeps every reservation. */
interface MountClaim { age: number; point: SettlementPoint }
export type MilitaryMountPointsSave = SavedEntries<MountClaim>;
/** A reservation lapses after this long (seconds). */
const CLAIM_SECONDS = 3;

/** Each door has a fan of distinct mounting places; the reservation covers the short exit. */
export const createMilitaryMountPoints = (context: SettlementContext) => {
  const held = new Map<number, MountClaim>();
  const choose = (actor: SettlementActor, building: SettlementBuilding, exit: SettlementPoint) => {
    const dx = building.access.x - building.workerApproach.x, dz = building.access.z - building.workerApproach.z;
    const yaw = DMath.atan2(dx, dz);
    const candidates: SettlementPoint[] = [];
    for (const distance of [1.2, 2.4, 4]) for (const angle of [0, 35, -35, 70, -70]) {
      const heading = yaw + angle * Math.PI / 180;
      candidates.push({ x: building.access.x + DMath.sin(heading) * distance,
        z: building.access.z + DMath.cos(heading) * distance });
    }
    for (let radius = 1; radius <= 8; radius++) for (let step = 0; step < 16; step++) {
      const heading = yaw + step * Math.PI / 8;
      candidates.push({ x: building.access.x + DMath.sin(heading) * radius,
        z: building.access.z + DMath.cos(heading) * radius });
    }
    for (const point of candidates) {
      if (!isMountedNavigationClear(context, point)) continue;
      if ([...held].some(([uid, claim]) => uid !== actor.uid && DMath.hypot(
        claim.point.x - point.x, claim.point.z - point.z) < 2.2)) continue;
      const path = groundPath(context, exit, point);
      if (!path) continue;
      held.set(actor.uid, { age: 0, point });
      return { path, point };
    }
    return undefined;
  };
  return {
    choose,
    clear: () => held.clear(),
    save: (): MilitaryMountPointsSave => saveEntries(held),
    restore: (saved: MilitaryMountPointsSave | undefined) => restoreEntries(held, saved),
    update: (dt: number) => {
      for (const [uid, claim] of held) {
        claim.age += dt;
        const actor = context.actors.find(actor => actor.uid === uid);
        if (!actor || claim.age >= CLAIM_SECONDS || (actor.phase === "militaryField" &&
          DMath.hypot(actor.x - claim.point.x, actor.z - claim.point.z) >= 2.2)) held.delete(uid);
      }
    }
  };
};
