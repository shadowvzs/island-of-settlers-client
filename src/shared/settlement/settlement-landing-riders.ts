import type { TransportHorseFrame } from "./settlement-horses";
import type { DeckHorse } from "./settlement-landing-deck-plan";
import type { SettlementActor, SettlementContext } from "./settlement-types";

/**
 * The landing party's riders and their horses (owner, 2026-10-15): a horse stands on deck held by its
 * rider until he mounts at his turn; mounted, its hidden actor goes where he rides, down the gangway and
 * on over the beach to his gathering place (riders ride on; they no longer get down to lead the horse).
 */
export const createLandingRiders = (context: SettlementContext) => {
  /** Each rider's horse actor while the rider is landing or on his way to the gathering place. */
  const horses = new Map<number, SettlementActor>();
  /** `party`: riders still landing; `mounts`: each rider's horse actor uid. */
  const arrange = (party: readonly SettlementActor[], mounts: ReadonlyMap<number, number>) => {
    const actors = new Map(context.actors.map(actor => [actor.uid, actor]));
    horses.clear();
    for (const rider of party) {
      const horse = actors.get(mounts.get(rider.uid) ?? NaN);
      if (horse) horses.set(rider.uid, horse);
    }
  };
  /** One tick for any actor: a rider's hidden horse goes with him. */
  const carry = (actor: SettlementActor) => {
    const horse = horses.get(actor.uid);
    if (!horse || !actor.mounted) return;
    Object.assign(horse, { x: actor.x, y: actor.y, yaw: actor.yaw, z: actor.z });
    if (actor.phase === "militaryField") horses.delete(actor.uid);
  };
  /** Horses standing on deck (`standing`: rider and his horse's place). */
  const frames = (standing: ReadonlyArray<{ actor: SettlementActor; horse: DeckHorse }>): TransportHorseFrame[] =>
    standing.flatMap(({ actor, horse }) => {
      const id = horses.get(actor.uid)?.uid;
      return id === undefined ? [] : [{ heading: horse.yaw, held: true, id, leader: actor.uid, moving: false,
        visible: true, x: horse.x, y: horse.y, z: horse.z }];
    });
  return { arrange, carry, frames };
};
