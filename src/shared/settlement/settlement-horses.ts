import { releaseCorridor } from "./settlement-corridor-reservations";
import { leaveStorageArrival } from "./settlement-door-traffic";
import { beginActorMovement } from "./settlement-navigation-recovery";
import { clearTrafficBlocker } from "./settlement-traffic-deadlock";
import type { SettlementActor, SettlementContext } from "./settlement-types";

export interface TransportHorseFrame {
  id: number; x: number; y: number; z: number; heading: number;
  moving: boolean; visible?: boolean; leader?: number;
  /** Its leader holds it by the lead rope (a landing rider). */
  held?: boolean;
  /** Render only: walk clip time advanced by the distance covered (hooves stay planted). */
  walkTime?: number;
}

/** Phases of a horse that belongs to a rider: hidden under it, called by it, or fallen with it. */
const MOUNT_PHASES: ReadonlySet<string> = new Set(["horseMounted", "horseDead"]);

/**
 * The commanders' horses (job `Mount`, the mount actor identity). Horses are only mounts: the
 * rider owns its horse and the commander's horse call moves it; a horse outside every mount phase
 * (no rider, no naval order) is removed. Civilian horse transport, breeding and horse wares are gone.
 */
export const createSettlementHorses = (context: SettlementContext) => {
  const animals: SettlementActor[] = [];
  const frames: TransportHorseFrame[] = [];
  const retirable = (horse: SettlementActor) => !horse.demolitionReturning &&
    !MOUNT_PHASES.has(horse.phase) && horse.navalOrder === undefined;
  const retireStray = () => {
    for (let index = animals.length - 1; index >= 0; index--) {
      const horse = animals[index]!;
      if (!retirable(horse)) continue;
      leaveStorageArrival(context, horse);
      releaseCorridor(context, horse.uid);
      clearTrafficBlocker(horse);
      animals.splice(index, 1);
      const actorIndex = context.actors.indexOf(horse);
      if (actorIndex >= 0) context.actors.splice(actorIndex, 1);
    }
  };
  const update = (dt: number) => {
    // These actors move before the ordinary settler loop. Preserve that tick's outcome
    // for walking/queue poses rather than resetting it after their movement finishes.
    for (const actor of context.actors) if (actor.job === "Mount") beginActorMovement(actor);
    for (const horse of animals) {
      if (horse.demolitionReturning || MOUNT_PHASES.has(horse.phase)) continue;
      if (!context.options.tickMask?.animationTime) horse.animationTime += dt;
    }
    retireStray();
  };
  const writeFrames = () => {
    while (frames.length < animals.length) frames.push({ id: animals[frames.length]!.uid, x: 0, y: 0, z: 0,
      heading: 0, moving: false });
    if (frames.length > animals.length) frames.length = animals.length;
    animals.forEach((horse, index) => Object.assign(frames[index]!, { x: horse.x, y: horse.y, z: horse.z,
      heading: horse.yaw, visible: horse.visible, moving: horse.action === "walk" }));
    return frames;
  };
  return {
    restore: () => {
      animals.splice(0, animals.length, ...context.actors.filter(actor => actor.job === "Mount"));
      frames.length = 0;
    },
    update,
    handles: (actor: SettlementActor) => actor.job === "Mount",
    frames: writeFrames
  };
};
