import { listShoreShellSpots } from "../../render-common/props/shore-shell-spots";
import { emitShellPickedUp } from "../script-world/nature/nature-events";
import type { SettlementBuilding, SettlementContext } from "./settlement-types";
import { collectShoreShell, getShoreShellPositions, type ShoreShellCollected } from "./shore-shell-collection";

/** The home island's headquarters (colonies start from a harbour, adventures from nothing). */
const HEADQUARTERS_TYPE = 0;

/**
 * Settlement commands of home-island shell collecting (quest prep). Only the home island (with a
 * headquarters, not a colony harbour or an adventure) collects; Minimal draws no shells, so there
 * is nothing to click there. Listeners hear every `shoreShellCollected` event (quests later).
 */
export const createSettlementShoreShells = (
  context: SettlementContext, headquarters: SettlementBuilding | undefined
) => {
  const listeners = new Set<(event: ShoreShellCollected) => void>();
  const isHome = () => headquarters?.typeId === HEADQUARTERS_TYPE;
  return {
    /**
     * Collects shore shell `index` (render-common/props/shore-shell-spots.ts order): it reappears
     * far away on the beach. Returns the event and both places, or null (not home, unknown shell,
     * no free far beach site).
     */
    collectShoreShell: (index: number) => {
      if (!isHome() || !context.shoreShells) return null;
      const result = collectShoreShell(context.options.world, context.shoreShells, index);
      if (!result) return result;
      emitShellPickedUp(context, index, result.event.kind);
      for (const listener of listeners) listener(result.event);
      return result;
    },
    /** Shells collected on this island so far (saved). */
    shoreShellsCollected: () => context.shoreShells?.collected ?? 0,
    /** Current ground position of every shore shell (picking); empty where nothing can be collected. */
    shoreShellPositions: () => isHome() && context.shoreShells
      ? getShoreShellPositions(context.options.world, context.shoreShells) : [],
    /** Original places of the shells that were moved (the renderer refreshes both places after a load). */
    movedShoreShells: () => {
      const moves = context.shoreShells?.moves ?? [], spots = listShoreShellSpots(context.options.world);
      const places: { x: number; z: number }[] = [];
      for (let at = 0; at + 2 < moves.length; at += 3)
        places.push(spots[moves[at]!]!, { x: moves[at + 1]!, z: moves[at + 2]! });
      return places;
    },
    /** Subscribes to collected-shell events; returns the unsubscribe. */
    onShoreShellCollected: (listener: (event: ShoreShellCollected) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
};
