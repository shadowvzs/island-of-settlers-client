import type { MultiboardSnapshot } from "../../../../../island-of-settlers-shared/src/script/types/multiboards";
import { createExternalStore } from "../../components/ui-store";
import { parsedCodec } from "../../preferences/codecs";
import { PREFERENCES } from "../../preferences/keys";
import { definePreference } from "../../preferences/registry";
import { formatLocalCollapse, type LocalCollapseMap, parseLocalCollapse } from "./helpers";

/**
 * The boards the script engine publishes for the viewer (`ScriptEngine.multiboardSnapshots`), with the map they
 * belong to. The publisher calls `publishMultiboards` at the settlement UI snapshot cadence; an unchanged list
 * (same identity) notifies nobody, so the view does no work between dirty cells.
 */
export interface MultiboardFeed {
  boards: readonly MultiboardSnapshot[];
  /** Identity of the running script (`scriptUid`): remembered header toggles are kept per map. */
  scope: string;
}

export const multiboardFeed = createExternalStore<MultiboardFeed>({ boards: [], scope: "" });

/** An empty list hides the stack (island teardown, a map without boards). */
export const publishMultiboards = (boards: readonly MultiboardSnapshot[], scope: string) => {
  const current = multiboardFeed.getSnapshot();
  if (current.boards === boards && current.scope === scope) return;
  multiboardFeed.set({ boards, scope });
};

const storedCollapse = definePreference(PREFERENCES.multiboardCollapse, parsedCodec(parseLocalCollapse,
  formatLocalCollapse));

/** The player's own header toggles (local UI state, never simulation; design §6.9). */
export const localCollapse = createExternalStore<LocalCollapseMap>(storedCollapse.read());

/** A refused storage only loses the convenience: the toggle still applies for this visit. */
export const rememberLocalCollapse = (next: LocalCollapseMap) => {
  localCollapse.set(next);
  storedCollapse.write(next);
};
