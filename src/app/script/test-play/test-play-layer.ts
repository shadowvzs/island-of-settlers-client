import type { SettlementSimulation } from "../../../shared/settlement/settlement-simulation";
import { TEST_PLAY_PUBLISH_TICKS } from "./constants";
import { createTestPlayLog } from "./test-play-log";

type TracedSimulation = Pick<SettlementSimulation, "observeTicks" | "script">;

/**
 * The play-test debug log of an island (admin play-test pages only): attaches the log as the script engine's
 * trace sink and shows the panel. Presentation only: the sink appends to a buffer, the panel reads a store that is
 * published every few ticks; nothing is written back to the simulation, so replay and state hashes are unchanged.
 */
export const startTestPlayLog = (simulation: TracedSimulation, parent: HTMLElement = document.body) => {
  const log = createTestPlayLog();
  const root = document.createElement("div");
  root.className = "test-play-layer";
  parent.append(root);
  let traced = simulation.script()?.engine;
  /** A reload in place builds a new engine: the sink follows it. */
  const attach = () => {
    const engine = simulation.script()?.engine;
    traced = engine;
    if (engine) engine.trace = entry => log.record(entry, engine.port.gameTick());
  };
  attach();
  let ticks = 0;
  const stopTicks = simulation.observeTicks(() => {
    if (simulation.script()?.engine !== traced) attach();
    ticks += 1;
    if (ticks % TEST_PLAY_PUBLISH_TICKS === 0) log.publish();
  });
  let disposed = false;
  let unmount: (() => void) | undefined;
  const mount = async () => {
    const { mountTestPlayPanel } = await import("./mount");
    if (!disposed) unmount = mountTestPlayPanel(root, { log, script: traced?.script });
  };
  void mount();
  return () => {
    disposed = true;
    stopTicks();
    if (traced) traced.trace = undefined;
    unmount?.();
    root.remove();
  };
};
