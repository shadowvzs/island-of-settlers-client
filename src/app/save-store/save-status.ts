import { createExternalStore } from "../components/ui-store";
import type { CloudSaveStatus } from "./remote-save-store";

/** Save state used by the save coordinator and cloud session (the Main selection no longer shows it). */
export interface SaveStatusSnapshot {
  /** The cloud slot's upload state (signed-in players only). */
  cloud: CloudSaveStatus | null;
  failed: boolean;
  lastSavedAt: number | null;
  saving: boolean;
}

export const createSaveStatus = () =>
  createExternalStore<SaveStatusSnapshot>({ cloud: null, failed: false, lastSavedAt: null, saving: false });

export type SaveStatusStore = ReturnType<typeof createSaveStatus>;


