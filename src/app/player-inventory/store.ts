import type { PlayerInventory } from "../../shared/progression/player-inventory";
import { createExternalStore } from "../components/ui-store";

interface InventorySession {
  progress: () => { inventory?: PlayerInventory };
  subscribeInventory: (listener: () => void) => () => void;
}
const EMPTY: PlayerInventory = Object.freeze({});
export const playerInventoryView = createExternalStore<PlayerInventory>(EMPTY);
let active = 0;

/** A view bridge to the active canonical session, never a second inventory authority. */
export const bindPlayerInventorySession = (session?: InventorySession) => {
  const token = ++active;
  const refresh = () => {
    if (token === active) playerInventoryView.set(session?.progress().inventory ?? EMPTY);
  };
  refresh();
  const unsubscribe = session?.subscribeInventory(refresh);
  return () => {
    unsubscribe?.();
    if (token === active) { active++; playerInventoryView.set(EMPTY); }
  };
};
