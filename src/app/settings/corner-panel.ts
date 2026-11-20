import type { MessageDescriptor } from "@lingui/core";

import { runWhenIdle } from "../components/lazy-react-content";
import { createExternalStore, type ExternalStore } from "../components/ui-store";
import { getWindowLayer, isolatePointer } from "../window-layer";
import { createCornerRow } from "./corner-row/corner-row";
import type { CornerIcon } from "./corner-row/helpers";

export interface CornerPanelSpec {
  /** Classes besides `settings-panel` (e.g. `development-menu`). */
  className?: string;
  /** The content below the header (a DOM element with its own lazily mounted React root). */
  content: HTMLElement;
  /** Row button icon; a panel without one has no row button (opened from elsewhere, e.g. a development tool). */
  icon?: CornerIcon;
  /** Row button id. */
  id: string;
  /** Accessible name and tooltip of the row button, title of the panel; a descriptor follows the locale. */
  label: string | MessageDescriptor;
  /** Called after the panel opened (e.g. refresh live values). */
  onOpen?: () => void;
}

/** A corner panel as its React frame renders it. */
export interface CornerPanelView {
  className?: string;
  content: HTMLElement;
  id: string;
  label: string | MessageDescriptor;
  open: boolean;
}

export type CornerPanelsStore = ExternalStore<readonly CornerPanelView[]>;

export interface CornerPanel {
  isOpen: () => boolean;
  setOpen: (open: boolean) => void;
  /** The row button's click: closes every corner panel, then opens this one unless it was open. */
  toggle: () => void;
}

/** Starts loading this long after the island is shown even if the main thread never idles (as the HUD). */
const IDLE_TIMEOUT_MS = 200;

const toPanelView = ({ className, content, id, label }: CornerPanelSpec): CornerPanelView =>
  ({ className, content, id, label, open: false });

/**
 * Top right corner: the icon row and the panels it opens. This React-free owner keeps the panels' state: one
 * is open at a time; an outside pointer press or Escape closes it. The React row and panel frames load once
 * the island is shown (next idle moment), so React stays out of the startup chunk.
 */
export const createCornerPanels = (container: HTMLElement, specs: readonly CornerPanelSpec[]) => {
  const root = document.createElement("div");
  root.className = "settings";
  const row = createCornerRow();
  const views: CornerPanelsStore = createExternalStore<readonly CornerPanelView[]>(specs.map(toPanelView));
  const isOpen = (id: string) => views.getSnapshot().some(view => view.id === id && view.open);
  const setOpen = (spec: CornerPanelSpec, open: boolean) => {
    if (isOpen(spec.id) !== open)
      views.set(views.getSnapshot().map(view => (view.id === spec.id ? { ...view, open } : view)));
    row.update(spec.id, { active: open, expanded: open });
    if (open) spec.onOpen?.();
  };
  const closeAll = () => specs.forEach(spec => setOpen(spec, false));
  const panels = specs.map((spec): CornerPanel => {
    const toggle = () => {
      const open = !isOpen(spec.id);
      closeAll();
      setOpen(spec, open);
    };
    if (spec.icon) row.add({ icon: spec.icon, id: spec.id, label: spec.label, onClick: toggle },
      { active: false, expanded: false });
    return { isOpen: () => isOpen(spec.id), setOpen: open => setOpen(spec, open), toggle };
  });
  const closePanel = (id: string) => panels[specs.findIndex(spec => spec.id === id)]?.setOpen(false);
  let loading: Promise<void> | undefined;
  let unmountCorner: (() => void) | undefined;
  let disposed = false;
  const events = new AbortController();
  const load = async () => {
    if (disposed) return;
    try {
      const { mountCorner } = await import("./corner-row/mount-corner");
      const unmount = mountCorner(root, { panels: views, row: row.store, onClose: closePanel });
      if (disposed) unmount();
      else unmountCorner = unmount;
    } catch (error) {
      loading = undefined;
      console.error("Corner buttons could not load", error);
    }
  };
  isolatePointer(root, undefined, events.signal);
  getWindowLayer(container).append(root);
  window.addEventListener("pointerdown", closeAll, { signal: events.signal });
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    // A closed panel consumed this Escape: later owners (the soldier selection) leave it alone.
    if (specs.some(spec => isOpen(spec.id))) event.preventDefault();
    closeAll();
  }, { signal: events.signal });
  return {
    /** Closes every open corner panel without changing its saved content. */
    closeAll,
    /** Releases the row/panel React roots, window listeners and the settings root. */
    dispose: () => {
      if (disposed) return;
      disposed = true;
      events.abort();
      unmountCorner?.();
      unmountCorner = undefined;
      root.remove();
    },
    /** Whether any corner panel (Settings, Map, Camera, Development) is open. */
    isAnyOpen: () => views.getSnapshot().some(view => view.open),
    /** Island shown: mount the React row and panels on the next idle moment (a failed load retries next time). */
    onIslandShown: () => {
      if (disposed) return;
      loading ??= new Promise(resolve => runWhenIdle(() => resolve(load()), IDLE_TIMEOUT_MS));
    },
    panels,
    row
  };
};
