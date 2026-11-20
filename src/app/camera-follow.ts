import { type CameraState,clampCamera } from "../render-common/camera-state";
import type { UnitDecisionReasonCode } from "../shared/settlement/unit-decision-diagnostics";

export interface ObservationRoute {
  points: readonly { x: number; z: number }[];
  index: number;
  /** Ships draw over the sea, rather than following submerged terrain. */
  surfaceY?: number;
  destination?: { x: number; z: number };
  truncated?: boolean;
}
export interface ObservationSubject {
  identity: object;
  shipId?: string;
  label: string;
  detail: string;
  x: number;
  y: number;
  z: number;
  /** Read-only decision reason; absent for ships and sandbox workers. */
  reason?: () => UnitDecisionReasonCode | undefined;
  route?: () => ObservationRoute | null;
}
type ResolveSubject = () => ObservationSubject | null;
const signature = (camera: CameraState) =>
  [camera.centerX, camera.centerZ, camera.zoom, camera.yaw, camera.tilt].join(",");

/** One selected subject; no timers, world snapshots, simulation commands or retained render meshes. */
export const createCameraFollow = (camera: CameraState, mapSize: readonly [number, number]) => {
  let resolve: ResolveSubject | null = null;
  let identity: object | null = null;
  let following = false;
  let writtenCamera = "";
  const stop = () => {
    following = false;
    writtenCamera = "";
  };
  const clear = () => {
    stop();
    resolve = null;
    identity = null;
  };
  const subject = () => {
    const current = resolve?.();
    if (
      !current ||
      current.identity !== identity ||
      ![current.x, current.y, current.z].every(Number.isFinite)
    ) {
      clear();
      return null;
    }
    return current;
  };
  return {
    clear,
    stop,
    subject,
    following: () => following,
    inspect: (next: ResolveSubject) => {
      clear();
      resolve = next;
      identity = next()?.identity ?? null;
      return subject();
    },
    follow: () => {
      if (!subject()) return false;
      following = true;
      writtenCamera = signature(camera);
      return true;
    },
    update: (delta: number) => {
      if (!resolve) return;
      const current = subject();
      if (!current || !following) return;
      // External camera writers (minimap/settings/edge scrolling) win over our last authored pose.
      if (writtenCamera && writtenCamera !== signature(camera)) {
        stop();
        return;
      }
      const amount = 1 - Math.exp(-Math.max(0, Math.min(delta, 0.1)) * 8);
      camera.centerX += (current.x - camera.centerX) * amount;
      camera.centerZ += (current.z - camera.centerZ) * amount;
      clampCamera(camera, ...mapSize);
      writtenCamera = signature(camera);
    }
  };
};
