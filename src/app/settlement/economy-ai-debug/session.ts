import { getBuildingDefinition } from "../../../render-common/buildings/building-catalog";
import { setFactionAiProbe } from "../../../shared/settlement/economy-ai/faction-ai-probe";
import type { SettlementSimulation } from "../../../shared/settlement/settlement-simulation";
import { createExternalStore, isDeepEqual, type ReadableStore } from "../../components/ui-store";
import { ECONOMY_AI_POLL_MS } from "./constants";
import { formatGameClock, getEconomyAiView } from "./helpers";
import { createPlotMarkOverlay } from "./plot-mark-overlay";
import { createEconomyAiProbeLog, type EconomyAiProbeLog, plotKey } from "./probe-log";
import type { EconomyAiPanelState } from "./types";

type OverlayOptions = Parameters<typeof createPlotMarkOverlay>[0];

export interface EconomyAiSessionOptions extends OverlayOptions {
  getSimulation: () => SettlementSimulation | undefined;
  /** Whether the window is open: the session reads and records only while it is. */
  open: ReadableStore<boolean>;
}

const buildingName = (typeId: number) => getBuildingDefinition(typeId).name;
const footprint = (typeId: number) => getBuildingDefinition(typeId).gridFootprint;

/** Forgets the recorded reasons of plots the factions' memos no longer hold. */
const pruneLog = (log: EconomyAiProbeLog, snapshots: ReturnType<SettlementSimulation["factionAiDiagnostics"]>) => {
  for (const { faction, planner } of snapshots)
    log.prunePlots(faction, new Set(planner?.memo?.map(({ entry, typeId }) => plotKey(typeId, entry))));
};

/**
 * The live half of the "why" window (loaded with its panel): while the window is open it installs the economy AI
 * probe recorder and reads the simulation's diagnostics twice a second into the panel's store and the map marks;
 * closed, it removes the recorder and its timer, so the simulation pays nothing.
 */
export const createEconomyAiSession = ({ getSimulation, open, renderer, viewport, world }: EconomyAiSessionOptions) => {
  const log = createEconomyAiProbeLog();
  const state = createExternalStore<EconomyAiPanelState>({ clock: "", factions: [] });
  const marksShown = createExternalStore(true);
  const overlay = createPlotMarkOverlay({ renderer, viewport, world });
  let timer: ReturnType<typeof setInterval> | undefined;

  const showMarks = () =>
    overlay.setMarks(marksShown.getSnapshot() ? state.getSnapshot().factions.flatMap(faction => faction.plots) : []);
  const read = () => {
    const simulation = getSimulation();
    if (!simulation) return;
    const snapshots = simulation.factionAiDiagnostics(), tick = simulation.gameTick();
    pruneLog(log, snapshots);
    const next: EconomyAiPanelState = {
      clock: formatGameClock(tick),
      factions: getEconomyAiView({
        authored: world.scenario?.factionAi ?? [], buildingName, cellsX: world.cellsX, footprint, logOf: log.of,
        snapshots, tick
      })
    };
    if (!isDeepEqual(next, state.getSnapshot())) state.set(next);
    showMarks();
  };
  const stop = () => {
    if (timer === undefined) return;
    clearInterval(timer);
    timer = undefined;
    setFactionAiProbe(null);
    log.clear();
    overlay.setMarks([]);
  };
  const start = () => {
    if (timer !== undefined) return;
    setFactionAiProbe(log.recorder);
    timer = setInterval(read, ECONOMY_AI_POLL_MS);
    read();
  };
  const follow = () => (open.getSnapshot() ? start() : stop());
  const stopFollowing = open.subscribe(follow);
  const stopMarks = marksShown.subscribe(showMarks);
  follow();
  return {
    dispose: () => {
      stopFollowing();
      stopMarks();
      stop();
      overlay.dispose();
    },
    marksShown,
    state
  };
};

export type EconomyAiSession = ReturnType<typeof createEconomyAiSession>;
