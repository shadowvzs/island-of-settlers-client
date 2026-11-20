import { DEFAULT_SAVE_TIMERS, type SaveTimers } from "./save-coordinator";

/** The camera fields whose change is player interaction (pan, zoom, rotate, tilt). */
interface CameraPose { centerX: number; centerZ: number; tilt: number; yaw: number; zoom: number }

interface IdleMomentOptions {
  camera: CameraPose;
  /** Building placement, road drawing or a drag in progress. */
  isInteracting: () => boolean;
  /** Settings or another corner menu is open. */
  isMenuOpen: () => boolean;
  isHidden?: () => boolean;
  now?: () => number;
  /** Input (pointer, wheel, keys) on this target counts as interaction. */
  target: Pick<EventTarget, "addEventListener" | "removeEventListener">;
  timers?: SaveTimers;
}

/** The camera and input must rest this long before a save may reload the island. */
export const IDLE_STILL_MS = 600;
const POLL_MS = 120;
const INPUT_EVENTS = ["keydown", "pointerdown", "pointermove", "wheel"] as const;

const poseKey = ({ centerX, centerZ, tilt, yaw, zoom }: CameraPose) => `${centerX}:${centerZ}:${tilt}:${yaw}:${zoom}`;

/**
 * Idle moments for saving (D3): the tab is hidden, a menu is open, or the camera and input have rested for
 * IDLE_STILL_MS. A waiting save polls cheaply; nothing runs while no save waits. Owned by one island.
 */
export const createIdleMoments = (options: IdleMomentOptions) => {
  const now = options.now ?? (() => performance.now());
  const isHidden = options.isHidden ?? (() => document.hidden);
  const timers = options.timers ?? DEFAULT_SAVE_TIMERS;
  let lastInput = -Infinity;
  let disposed = false;
  const waiters = new Set<() => void>();
  const noteInput = () => { lastInput = now(); };
  for (const type of INPUT_EVENTS) options.target.addEventListener(type, noteInput, { passive: true });
  const isIdle = (pose: string, stillSince: number) => {
    if (isHidden() || options.isMenuOpen()) return true;
    if (options.isInteracting() || poseKey(options.camera) !== pose) return false;
    return now() - Math.max(stillSince, lastInput) >= IDLE_STILL_MS;
  };
  const whenIdle = (signal?: AbortSignal) => new Promise<void>(resolve => {
    if (disposed || signal?.aborted) { resolve(); return; }
    let timer: ReturnType<SaveTimers["set"]> | undefined;
    const finish = () => {
      if (timer !== undefined) timers.clear(timer);
      waiters.delete(finish);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    waiters.add(finish);
    signal?.addEventListener("abort", finish, { once: true });
    let pose = poseKey(options.camera), stillSince = now();
    const check = () => {
      if (isIdle(pose, stillSince)) { finish(); return; }
      const current = poseKey(options.camera);
      if (current !== pose) { pose = current; stillSince = now(); }
      timer = timers.set(check, POLL_MS);
    };
    check();
  });
  return {
    dispose: () => {
      disposed = true;
      for (const type of INPUT_EVENTS) options.target.removeEventListener(type, noteInput);
      for (const finish of waiters) finish();
    },
    whenIdle
  };
};
