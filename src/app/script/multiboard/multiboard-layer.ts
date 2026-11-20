import { BELOW_NEIGHBOUR_GAP_PX, TOP_PROPERTY } from "./constants";
import { multiboardFeed } from "./multiboard-store";

/** Keeps the stack below a panel sharing its corner; measured only when that panel changes size or visibility. */
const followNeighbour = (root: HTMLElement, neighbour: HTMLElement | undefined) => {
  if (!neighbour || typeof ResizeObserver === "undefined") return () => undefined;
  const place = () => {
    const bounds = neighbour.getBoundingClientRect();
    if (bounds.height === 0) root.style.removeProperty(TOP_PROPERTY);
    else root.style.setProperty(TOP_PROPERTY, `${Math.round(bounds.bottom + BELOW_NEIGHBOUR_GAP_PX)}px`);
  };
  const observer = new ResizeObserver(place);
  observer.observe(neighbour);
  return () => observer.disconnect();
};

/**
 * DOM owner of the multiboard stack. It stays an empty hidden element until the script shows a board; the React
 * view then loads once and follows the feed by itself. `neighbour` is the panel docked in the same corner (the
 * colony tracker): the stack sits below it while it is shown. Nothing here runs per frame.
 */
export const createMultiboardLayer = (neighbour?: HTMLElement) => {
  const root = document.createElement("div");
  root.className = "multiboard-layer";
  root.hidden = true;
  let unmount: (() => void) | undefined;
  let requested = false;
  let disposed = false;
  const mount = async () => {
    requested = true;
    const { mountMultiboardStack } = await import("./mount");
    if (!disposed) unmount = mountMultiboardStack(root);
  };
  const sync = () => {
    root.hidden = multiboardFeed.getSnapshot().boards.length === 0;
    if (!root.hidden && !requested) void mount();
  };
  const unsubscribe = multiboardFeed.subscribe(sync);
  const unfollow = followNeighbour(root, neighbour);
  sync();
  return {
    root,
    dispose: () => {
      disposed = true;
      unsubscribe();
      unfollow();
      unmount?.();
      root.remove();
    }
  };
};
