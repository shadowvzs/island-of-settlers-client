/**
 * CIN3 cinematic mode (plan sections 3.3 and 3.7): entering snapshots the camera and view mode, suspends the
 * possessed/commander views (never leaving them: owner answer Q1), hides the HUD through the shared HUD scope and
 * locks input; exiting undoes it in reverse order with the exact camera restore.
 */
import type { CameraState } from "../../../render-common/camera-state";
import type { TerrainRenderer } from "../../../render-common/renderer-contract";
import type { HudScope } from "../../hud-scope/hud-scope";
import { type CameraSnapshot, restoreCameraSnapshot, takeCameraSnapshot } from "./camera-snapshot";
import type { CinematicModePort } from "./ports";

/** A view that a cinematic suspends and resumes (exploration, commander control). */
export interface CinematicSuspendable {
  setSuspended: (suspended: boolean) => void;
}

export interface CinematicModeOptions {
  camera: CameraState;
  hud: Pick<HudScope, "set">;
  lock: { setActive: (active: boolean) => void };
  /** Read on every enter: the views may be created after the cinematic runtime. */
  suspendables: () => readonly (CinematicSuspendable | undefined)[];
  view: Pick<TerrainRenderer, "getViewMode" | "setViewMode">;
}

export const createCinematicMode = (options: CinematicModeOptions): CinematicModePort & { active: () => boolean } => {
  const { camera, hud, lock, view } = options;
  let snapshot: CameraSnapshot | null = null;
  let suspended: CinematicSuspendable[] = [];
  return {
    active: () => snapshot !== null,
    enter: () => {
      if (snapshot) return;
      snapshot = takeCameraSnapshot(camera, view);
      suspended = options.suspendables().filter((entry): entry is CinematicSuspendable => entry !== undefined);
      for (const entry of suspended) entry.setSuspended(true);
      hud.set(true);
      lock.setActive(true);
    },
    exit: () => {
      if (!snapshot) return;
      lock.setActive(false);
      hud.set(false);
      restoreCameraSnapshot(snapshot, camera, view);
      for (const entry of suspended) entry.setSuspended(false);
      suspended = [];
      snapshot = null;
    }
  };
};
