import { runWhenIdle } from "../../components/lazy-react-content";
import type { SettlementHudProps } from "./types";

/** Starts loading this long after the island is shown even if the main thread never idles. */
const IDLE_TIMEOUT_MS = 200;

/**
 * The HUD's React chunk loads once the island is shown (on the next idle moment), so React stays out of
 * the startup chunk and off the loading path; until then the hosts stay empty. A failed load is retried
 * on the next `onIslandShown`.
 */
export const createSettlementHudLoader = (props: SettlementHudProps) => {
  let loading: Promise<void> | undefined;
  let unmount: (() => void) | undefined;
  let disposed = false;
  const load = async () => {
    try {
      const { mountSettlementHud } = await import("./mount");
      if (!disposed) unmount = mountSettlementHud(props);
    } catch (error) {
      loading = undefined;
      console.error("Settlement HUD could not load", error);
    }
  };
  return {
    onIslandShown: () => {
      if (loading || disposed) return;
      loading = new Promise(resolve => runWhenIdle(() => resolve(load()), IDLE_TIMEOUT_MS));
    },
    dispose: () => {
      disposed = true;
      unmount?.();
    }
  };
};
