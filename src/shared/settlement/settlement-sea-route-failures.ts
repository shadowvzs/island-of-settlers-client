import type { WorldData } from "../world/world-data";
import type { ShipObstacle } from "./settlement-ship-clearance";
import type { SettlementPoint } from "./settlement-types";

const MAX_CERTIFICATES = 16;
const MAX_BYTES = 1024 * 1024;
const pose = (ship: ShipObstacle) => [ship.x, ship.z, ship.yaw]
  .map(value => Object.is(value, -0) ? "-0" : String(value)).join(",");

interface FailureCertificate { blocked: readonly string[]; reachable: Uint8Array }

/** Complete directed reachability is closed under edges, including after additional hulls block edges. */
export const createSeaRouteFailures = (world: WorldData) => {
  const certificates = new Map<string, FailureCertificate>();
  let bytes = 0;
  let width = world.cellsX, depth = world.cellsZ;
  const cell = (point: SettlementPoint) => Math.floor(point.z) * world.cellsX + Math.floor(point.x);
  const clear = () => { certificates.clear(); bytes = 0; width = world.cellsX; depth = world.cellsZ; };
  const refreshBounds = () => { if (width !== world.cellsX || depth !== world.cellsZ) clear(); };
  return {
    clear,
    unreachable: (from: SettlementPoint, to: SettlementPoint, blocked: readonly ShipObstacle[]) => {
      refreshBounds();
      const first = cell(from), last = cell(to), poses = blocked.map(pose);
      const known = certificates.get(`${first}:${poses.join(";")}`);
      if (known) return !known.reachable[last];
      let current: Set<string> | undefined;
      for (const certificate of certificates.values()) {
        if (!certificate.reachable[first] || certificate.reachable[last]) continue;
        current ??= new Set(poses);
        // Every path starting inside this full forward closure stays inside it. Adding exact
        // obstacle poses only removes edges; it cannot make an outside goal reachable.
        if (certificate.blocked.every(value => current!.has(value))) return true;
      }
      return false;
    },
    record: (from: SettlementPoint, blocked: readonly ShipObstacle[], reachable: Uint8Array) => {
      refreshBounds();
      if (reachable.byteLength > MAX_BYTES || reachable.length !== width * depth) return;
      const poses = blocked.map(pose), current = `${cell(from)}:${poses.join(";")}`;
      const previous = certificates.get(current);
      if (previous) { bytes -= previous.reachable.byteLength; certificates.delete(current); }
      while (certificates.size >= MAX_CERTIFICATES || bytes + reachable.byteLength > MAX_BYTES) {
        const oldest = certificates.keys().next().value!;
        bytes -= certificates.get(oldest)!.reachable.byteLength;
        certificates.delete(oldest);
      }
      certificates.set(current, { blocked: poses, reachable: reachable.slice() });
      bytes += reachable.byteLength;
    }
  };
};
