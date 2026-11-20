import type { MountClipName } from "@workers/mount-clips";

import type { CommanderLoadout } from "../../shared/settlement/settlement-commander";
import { WORKER_ASSET_BASE } from "../workers/worker-assets";
import type { WorkerNation } from "../workers/worker-unit";

/**
 * Mounted troops and the `?horse=1` preview share the existing horse and riding-worker assets.
 * Source clips live in the generator repository (game_ready/mounts); the production
 * asset pipeline includes the riding rigs, coats and clips under workers/mounts/.
 */
export const MOUNT_ASSET_BASE = `${WORKER_ASSET_BASE}mounts/`;

export interface MountAppearance {
  /** Rider body (a Tripo worker id with a riding variant). */
  rider: string;
  /** Coat id (`@workers/mount-coats`). */
  coat: string;
}

export interface MountFrame extends MountAppearance {
  actorId?: number;
  /** Player commander: centurion armour, national command standard and aura. */
  commander?: boolean;
  commanderLoadout?: CommanderLoadout;
  /** Actual player aim while possessing a bow commander; ordinary AI poses remain unchanged. */
  manualBowPitch?: number;
  /** Actual possession snapshot owns this body; presentation only. */
  manualControl?: boolean;
  /** The aura is inactive aboard/boarding and during a fall; presentation only, never gameplay. */
  auraActive?: boolean;
  faction?: number;
  selected?: boolean;
  /** An enemy rider the player's soldiers chase (targetMilitary): its ground ring shows red. */
  targeted?: boolean;
  nation?: WorkerNation;
  attackProgress?: number | null;
  /** 0..1: how far the rider has raised its sword into a parry against a blow aimed at it. */
  guard?: number;
  /** Player guard pose remains clear of the rider eye while keeping the real weapon. */
  manualGuard?: boolean;
  /** 0..1: how far an attacking horse has turned and stepped up to its target (eases in and out). */
  engage?: number;
  x: number;
  y: number;
  z: number;
  /** Facing about +y (0 = +z), as the workers. */
  heading: number;
  /** The horse clip; the rider plays its riding clip of the same name. */
  clip: MountClipName;
  /** Seconds into the clip (both clips share it). */
  clipTime: number;
  /** Heading change (radians per second, + = turning left): the horse bends into it. */
  turnRate: number;
  /** 0..1 while a slain rider and his horse go down onto the horse's right side. */
  fall?: number;
}
