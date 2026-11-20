import type { FrameState, TerrainRenderer } from "../../render-common/renderer-contract";
import type { WorkerNation } from "../../render-common/workers/worker-unit";
import type { WorldData } from "../../shared/world/world-data";
import { downloadJson } from "../helpers";
import { setBeforePageReload } from "../page-reload";
import { compressSceneData, encodeSceneData } from "./codec";
import { createSceneJournal, readSceneReplay, type SceneReplay } from "./journal";
import { createReplayPanel } from "./replay-panel";
import { sceneReplayStorage } from "./storage";
import { createSceneWorldTracker } from "./world-delta";

export interface SceneReplayBoot { position: number; report: SceneReplay; segment: number }

const SAMPLE_SECONDS = .1;
const MEBIBYTE = 1048576;
/** World bytes compared per sample: a 512² island (18 MiB) is fully compared every ~0.5 s. */
const WORLD_COMPARE_BUDGET = 4 * MEBIBYTE;

interface PlaybackSelection { position?: unknown; segment?: unknown }

/** Recording cost (CPU per captured sample, journal size): `window.__sceneReplayStats` (benchmarks). */
interface SceneRecordingStats { bytes: number; maxMs: number; samples: number; seconds: number; totalMs: number }

export const readSceneReplayBoot = async (): Promise<SceneReplayBoot | undefined> => {
  if (new URLSearchParams(location.search).get("sceneReplay") !== "1") return;
  const text = await sceneReplayStorage.read("report");
  const selected = await sceneReplayStorage.read("playback");
  if (!text) throw new Error("No full-scene replay imported or recorded");
  const report = readSceneReplay(text);
  const choice: PlaybackSelection = selected ? JSON.parse(selected) : {};
  const segment = Number.isSafeInteger(choice.segment) ? choice.segment as number : 0;
  if (!report.segments[segment]) throw new Error("Invalid replay island selection");
  const position = Number.isFinite(choice.position) ? choice.position as number : 0;
  return { position, report, segment };
};

const openViewer = async (report: SceneReplay) => {
  await sceneReplayStorage.write("report", encodeSceneData(report));
  await sceneReplayStorage.write("playback", JSON.stringify({ position: 0, segment: 0 }));
  const url = new URL(location.href);
  url.searchParams.set("sceneReplay", "1");
  window.open(url.href, "_blank", "noopener");
};

const recordingMessage = (bytes: number, active: boolean) => {
  const stopped = active ? "" : " · stopped at capacity";
  return `Recording full scene · ${(bytes / MEBIBYTE).toFixed(1)} MiB / 64 MiB${stopped}`;
};

interface SceneRecorderOptions {
  nation: WorkerNation;
  renderer: TerrainRenderer;
  world: WorldData;
  getWorkerColor: () => string;
}

const emptyStats = (): SceneRecordingStats => ({ bytes: 0, maxMs: 0, samples: 0, seconds: 0, totalMs: 0 });

/**
 * Opt-in recording of the actual drawn frames (game, map editor, any island), independent of the
 * command reproduction tool. Each island is a segment: its start world plus sparse world deltas.
 */
export const createSceneReplayRuntime = ({ getWorkerColor, nation, renderer, world }: SceneRecorderOptions) => {
  const ui = createReplayPanel();
  let journal = createSceneJournal();
  let tracker: ReturnType<typeof createSceneWorldTracker> | undefined;
  let origin = 0;
  let nextSample = 0;
  let pending: Promise<void> | undefined;
  let finished = false;
  let stats = emptyStats();
  (window as Window & { __sceneReplayStats?: () => SceneRecordingStats }).__sceneReplayStats = () => stats;
  const beginSegment = async () => {
    tracker = createSceneWorldTracker(world, WORLD_COMPARE_BUDGET);
    const start = await compressSceneData(tracker.baseline());
    origin = NaN;
    nextSample = 0;
    stats = emptyStats();
    journal.beginSegment(`Island ${world.seed}`, nation, start);
    ui.show(true);
    ui.message("Recording full scene (10 Hz, 64 MiB limit)");
  };
  const beginPending = () => {
    pending = beginSegment().finally(() => { pending = undefined; });
    return pending;
  };
  const persist = async () => {
    await pending;
    if (!journal.active()) return;
    await sceneReplayStorage.write("resume", encodeSceneData(journal.report()));
  };
  setBeforePageReload(persist);
  const hasSamples = () => journal.report().segments.some(segment => segment.samples.length > 0);
  const downloadReport = () => {
    if (!hasSamples()) {
      ui.message("No full-scene frames recorded");
      return false;
    }
    try {
      downloadJson(JSON.parse(encodeSceneData(journal.report())), "full-scene-replay.json");
      return true;
    } catch (error) {
      ui.message(String(error));
      return false;
    }
  };
  const stopRecording = () => {
    journal.stop();
    ui.show(false);
  };
  const capture = (frame: FrameState) => {
    if (!journal.active() || frame.time < nextSample || !tracker) return;
    const started = performance.now();
    if (!Number.isFinite(origin)) origin = frame.time;
    // A steady 10 Hz grid; at the start or after a stall it restarts from this frame.
    const behind = frame.time - nextSample > SAMPLE_SECONDS;
    nextSample = (behind ? frame.time : nextSample) + SAMPLE_SECONDS;
    const edits = tracker.collect();
    const presentation = { viewMode: renderer.getViewMode(), workerColor: getWorkerColor() };
    journal.capture(frame.time - origin, frame, edits.length ? edits : undefined, presentation);
    ui.message(recordingMessage(journal.bytes(), journal.active()));
    const spent = performance.now() - started;
    stats = { bytes: journal.bytes(), maxMs: Math.max(stats.maxMs, spent), samples: stats.samples + 1,
      seconds: frame.time - origin, totalMs: stats.totalMs + spent };
  };
  return {
    start: () => {
      if (pending) return pending;
      if (journal.active()) {
        stopRecording();
        finished = downloadReport() || finished;
        return Promise.resolve();
      }
      // A recording that stopped itself at capacity is still in the journal.  Save it instead of
      // silently resetting it on the next click; the following click starts a fresh recording.
      if (finished) {
        journal.reset();
        finished = false;
      } else if (hasSamples()) {
        finished = downloadReport();
        return Promise.resolve();
      }
      journal.reset();
      return beginPending();
    },
    /** Continues a recording carried over a page reload as the next island segment. */
    resume: async () => {
      const text = await sceneReplayStorage.read("resume");
      if (!text) return;
      await sceneReplayStorage.write("resume", "");
      journal = createSceneJournal(readSceneReplay(text));
      await beginPending();
    },
    recording: () => journal.active(),
    export: () => {
      stopRecording();
      finished = downloadReport();
    },
    import: async (file: File) => { await openViewer(readSceneReplay(await file.text())); },
    play: async () => {
      stopRecording();
      finished = hasSamples();
      await openViewer(journal.report());
    },
    capture,
    dispose: async () => {
      const active = journal.active();
      await pending;
      stopRecording();
      setBeforePageReload(undefined);
      if (active) await sceneReplayStorage.write("resume", encodeSceneData(journal.report()));
      ui.panel.remove();
    },
    report: () => journal.report()
  };
};
export type SceneReplayRuntime = ReturnType<typeof createSceneReplayRuntime>;
