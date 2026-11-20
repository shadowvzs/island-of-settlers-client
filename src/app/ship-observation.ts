import type { ShipFrame } from "../render-common/ships/ship-frame";
import type { createCameraFollow, ObservationRoute, ObservationSubject } from "./camera-follow";
import { observeShip } from "./observation-subjects";

export interface ShipObservationControls {
  canFollow: (id: string) => boolean;
  isFollowing: (id: string) => boolean;
  stop: (id: string) => void;
  toggle: (id: string) => void;
}

/** Shared camera action for the ship register; fleet snapshots are read only when starting follow. */
export const createShipObservation = (options: {
  follower: ReturnType<typeof createCameraFollow>;
  follow: (resolve: () => ObservationSubject | null) => boolean;
  frames: () => readonly ShipFrame[];
  name: (id: string) => string;
  route?: (id: number) => ObservationRoute | null | undefined;
}): ShipObservationControls => {
  const isFollowing = (id: string) =>
    options.follower.following() && options.follower.subject()?.shipId === id;
  const canFollow = (id: string) =>
    options
      .frames()
      .some((ship) => String(ship.id) === id && ship.phase !== "away" && ship.livery !== "enemy");
  const stop = (id: string) => {
    if (isFollowing(id)) options.follower.stop();
  };
  return {
    canFollow,
    isFollowing,
    stop,
    toggle: (id: string) => {
      if (isFollowing(id)) {
        stop(id);
        return;
      }
      if (!canFollow(id)) return;
      options.follow(observeShip(id, options.name(id), options.frames, options.route));
    }
  };
};
