import type { SettlementBuilding } from "../../shared/settlement/settlement-types";
import { getViewportPoint } from "../helpers";

/** The mouse over the map: a viewport point (CSS pixels) and the order modifiers held with it. */
export interface MapHoverSample {
  altKey: boolean;
  ctrlKey: boolean;
  x: number;
  y: number;
}

type HoverListener = (sample: MapHoverSample | null) => void;

interface MapHoverPickOptions {
  /** The map viewport: pointer coordinates are relative to it. */
  mount: HTMLElement;
  /** The settlement's ground-plot building picker (the left-click chain's): it finds scenario-placed forts. */
  pickBuilding: (x: number, y: number) => SettlementBuilding | undefined;
  /** The map canvas: hovering a window over it is no map hover. */
  surface: HTMLElement;
}

/**
 * One shared map hover (military controls §4.11): the hostile garrison tooltip and the soldiers' target hover
 * read the same pointer sample and the same building pick, which runs at most once per sample and only when a
 * listener asks for it. Mouse and pen only: a touch, a pressed button or leaving the map clears the sample.
 * Listeners hear about a moved pointer once per animation frame, and about a cleared one at once.
 */
export const createMapHoverPick = (options: MapHoverPickOptions) => {
  const events = new AbortController();
  const listeners = new Set<HoverListener>();
  let sample: MapHoverSample | null = null;
  let serial = 0, frame = 0;
  let picked: { building: SettlementBuilding | undefined; serial: number } | null = null;

  const notify = () => {
    frame = 0;
    for (const listener of listeners) listener(sample);
  };
  const clear = () => {
    if (frame) { cancelAnimationFrame(frame); frame = 0; }
    if (!sample) return;
    sample = null;
    notify();
  };
  const onPointerMove = (event: PointerEvent) => {
    if (event.target !== options.surface || event.buttons || event.pointerType === "touch") return clear();
    const point = getViewportPoint(options.mount, event);
    sample = { altKey: event.altKey, ctrlKey: event.ctrlKey, x: point.x, y: point.y };
    serial++;
    if (!frame) frame = requestAnimationFrame(notify);
  };
  /** The building under the current sample; picked once per sample, however many listeners ask. */
  const building = () => {
    if (!sample) return undefined;
    if (picked?.serial !== serial) picked = { building: options.pickBuilding(sample.x, sample.y), serial };
    return picked.building;
  };
  options.mount.addEventListener("pointermove", onPointerMove, { passive: true, signal: events.signal });
  options.mount.addEventListener("pointerleave", clear, { signal: events.signal });
  return {
    building,
    current: () => sample,
    subscribe: (listener: HoverListener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    dispose: () => {
      events.abort();
      cancelAnimationFrame(frame);
      listeners.clear();
    }
  };
};

export type MapHoverPick = ReturnType<typeof createMapHoverPick>;
