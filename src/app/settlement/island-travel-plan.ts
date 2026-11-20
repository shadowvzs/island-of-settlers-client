import {
  type Archipelago,
  colonySurvivors,
  findAdventure,
  travelTo
} from "../../shared/settlement/archipelago";
import type { GameSaveV1 } from "../../shared/settlement/game-save";
import type { EmigratedTroop } from "../../shared/settlement/settlement-military";
import { type SessionToken, SessionTransitionCancelled } from "../session-lifecycle";

interface IslandTravelOptions {
  capture: () => Promise<GameSaveV1>;
  endIsland: (group: Archipelago, id: number, survivors: readonly EmigratedTroop[]) => Promise<Archipelago | null>;
  group: () => Archipelago;
  settle?: () => Promise<void>;
  target: number | null;
  token: SessionToken;
}

/** Reload and in-page travel settle finished adventures at the same frozen capture boundary. */
export const prepareIslandTravel = async (options: IslandTravelOptions) => {
  const { target, token } = options;
  await options.settle?.();
  if (!token.current()) throw new SessionTransitionCancelled();
  const current = await options.capture();
  if (!token.current()) throw new SessionTransitionCancelled();
  const group = options.group();
  const departure = travelTo(group, current, group.active) as GameSaveV1;
  const adventure = findAdventure(group, group.active);
  if (!adventure || (adventure.status !== "won" && adventure.status !== "defeated"))
    return { departure, payload: travelTo(group, current, target) };

  const ended = await options.endIsland({ ...group, active: null, adventures: group.adventures?.map(record =>
    record.expeditionId === adventure.expeditionId ? { ...record, save: current } : record) }, adventure.expeditionId,
    colonySurvivors(current));
  if (!ended || !token.current()) throw new SessionTransitionCancelled();
  const home = { ...ended.home!, player: current.player };
  const homeGroup = { ...ended, active: null, home: undefined };
  const payload = target === null ? { ...home, archipelago: homeGroup } : travelTo(homeGroup, home, target);
  return { departure, payload };
};
