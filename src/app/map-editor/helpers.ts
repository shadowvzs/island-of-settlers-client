import type { TerrainRenderer } from "../../render-common/renderer-contract";
import { MAP_FILE_EXTENSION } from "../../shared/world/save/map-format";
import type { WorldData } from "../../shared/world/world-data";
import { downloadBlob } from "../helpers";
import type { EditorText } from "./messages";

const MAX_FILE_NAME = 60;

/** A safe download name for the map (letters, digits, dashes) with the map extension. */
export const toMapFileName = (name: string) => {
  const safe = name
    .trim()
    .replace(/[^\p{L}\p{N} _-]+/gu, "")
    .replace(/\s+/g, "-")
    .slice(0, MAX_FILE_NAME);
  return `${safe || "island"}${MAP_FILE_EXTENSION}`;
};

/** Short local date and time of a save. */
export const formatSaveDate = (savedAt: number) =>
  new Date(savedAt).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });

/** A file size in KB or MB. */
export const formatFileSize = (bytes: number) => {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

/** Hands the bytes to the browser as a file download. */
export const downloadBytes = (bytes: Uint8Array, fileName: string) =>
  downloadBlob(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/octet-stream" }), fileName);

/** What a key press asks of the edit history: Ctrl+Z undo, Ctrl+Y or Ctrl+Shift+Z redo. */
export const getHistoryShortcut = (
  event: Pick<KeyboardEvent, "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey">
) => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key === "y") return "redo";
  if (key !== "z") return null;
  return event.shiftKey ? "redo" : "undo";
};

/** A text field has the focus (it keeps its own Ctrl+Z). */
export const isTextEntry = (target: EventTarget | null) =>
  target instanceof Element && target.matches("input, textarea, [contenteditable]");

/** Adds a change listener; returns its unsubscribe (stores read by `useSyncExternalStore`). */
export const addListener = <T>(listeners: T[], listener: T) => {
  listeners.push(listener);
  return () => {
    const index = listeners.indexOf(listener);
    if (index >= 0) listeners.splice(index, 1);
  };
};

interface WorldRevisionParts {
  /** Adds the prop count (moved or removed props invalidate the result). */
  props?: boolean;
  /** Adds the colony resource tier. */
  tier?: boolean;
}

/** Revision stamp of the edited world that stale results compare: build / terrain revision (+ props, tier). */
export const getWorldRevision = (world: WorldData, { props = false, tier = false }: WorldRevisionParts = {}) => {
  let stamp = `${world.buildRevision ?? 0}/${world.terrainRevision ?? 0}`;
  if (props) stamp += `/${world.props.count}`;
  if (tier) stamp += `/${world.colonyResourceTier ?? 0}`;
  return stamp;
};

/** The ground point at the centre of the view; null when it does not hit terrain. */
export const pickViewCentre = (renderer: Pick<TerrainRenderer, "pickGround">, viewport: HTMLElement) =>
  renderer.pickGround(viewport.clientWidth / 2, viewport.clientHeight / 2);

/** A section that shows an inspection's busy state and its result or failure text. */
interface InspectionSection {
  update: (change: { busy?: boolean; status?: EditorText }) => void;
}

/**
 * Runs an inspection on the next task (the busy state paints first): its returned text becomes the status, a
 * failure shows its message (else `fallback`) after `onError`; either way the section is no longer busy.
 */
export const runDeferredInspection = (
  section: InspectionSection, inspect: () => EditorText, fallback: EditorText, onError?: () => void
) => {
  setTimeout(() => {
    try {
      section.update({ status: inspect() });
    } catch {
      onError?.();
      section.update({ status: fallback });
    } finally {
      section.update({ busy: false });
    }
  }, 0);
};

/** Marks the world's build layers stale (scenario, ore or identity edits): build-space caches recompute. */
export const bumpBuildRevision = (world: WorldData) => {
  world.buildRevision = (world.buildRevision ?? 0) + 1;
};
