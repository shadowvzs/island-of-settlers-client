import { FORMATS, isFormat } from "../../../../island-of-settlers-shared/src/formats";
import { isNation } from "../../../../island-of-settlers-shared/src/nations";
import type { FrameState } from "../../render-common/renderer-contract";
import type { WorkerNation } from "../../render-common/workers/worker-unit";
import { decodeSceneData, encodeSceneData, SCENE_REPLAY_MAX_BYTES } from "./codec";
import { inheritSharedFields, type SceneFrameData, snapshotSceneFrame } from "./frame-snapshot";

interface ScenePresentation { viewMode: "iso" | "cinematic"; workerColor: string }
/** `worldRevision`: how many of the segment's world deltas apply to this frame. */
export interface SceneSample {
  at: number; frame: SceneFrameData; presentation?: ScenePresentation; worldRevision: number
}
export interface SceneSegment {
  /** World edits (terrain, fog, props) after the island's start world, as encoded scene data. */
  deltas: { at: number; data: string }[];
  island: string;
  nation: WorkerNation;
  samples: SceneSample[];
  /** The island's whole world at the segment start: packed, gzipped, base64 (codec). */
  world: string;
}
export interface SceneReplay {
  kind: "settlers-full-scene";
  limits: string[];
  sampleSeconds: number;
  segments: SceneSegment[];
  truncated: boolean;
  version: typeof FORMATS.sceneReplay.current;
}

const MAX_SEGMENTS = 128;
const MIN_SAMPLE_SECONDS = .016;
const RECORDING_LIMITS = [
  "Captured snapshots at up to 10 Hz, interpolated on playback; no rerun of wildlife/AI",
  "64 MiB encoded limit; recording stops honestly at capacity",
  "Hidden browser tabs do not produce frames"
];

const emptyReport = (): SceneReplay => ({ kind: "settlers-full-scene", limits: [...RECORDING_LIMITS],
  sampleSeconds: .1, segments: [], truncated: false,
  version: FORMATS.sceneReplay.current });

export const createSceneJournal = (initial?: SceneReplay, byteLimit = SCENE_REPLAY_MAX_BYTES) => {
  const capacity = Math.min(SCENE_REPLAY_MAX_BYTES, byteLimit);
  // Headroom for the report envelope, so an exported journal always decodes within the limit.
  const usable = capacity - Math.min(4096, capacity / 4);
  let report = initial ?? emptyReport();
  let active = false;
  let bytes = encodeSceneData(report).length;
  let last = -Infinity;
  /** The last stored frame with its left-out parts filled in: what the next frame compares with. */
  let lastFrame: SceneFrameData | undefined;
  /** Adds an encoded entry when it fits; otherwise the recording stops at capacity. */
  const append = (size: number, apply: () => void) => {
    if (bytes + size > usable) {
      report.truncated = true;
      active = false;
      return false;
    }
    bytes += size;
    apply();
    return true;
  };
  return {
    beginSegment: (island: string, nation: WorkerNation, world: string) => {
      const segment: SceneSegment = { deltas: [], island, nation, samples: [], world };
      if (!append(encodeSceneData(segment).length, () => report.segments.push(segment))) return;
      active = true;
      last = -Infinity;
      lastFrame = undefined;
    },
    capture: (at: number, frame: FrameState, changedWorld?: unknown, presentation?: ScenePresentation) => {
      // The recorder keeps a 10 Hz grid; frames land a little after their grid time, so two
      // samples may be closer than the interval (never closer than half of it).
      if (!active || at - last < report.sampleSeconds / 2) return;
      const segment = report.segments.at(-1)!;
      if (changedWorld) {
        const state = { at, data: encodeSceneData(changedWorld) };
        if (!append(state.data.length + 32, () => segment.deltas.push(state))) return;
      }
      // One encoding serves the size budget and, decoded, the immutable stored copy.
      const snapshot = snapshotSceneFrame(frame, lastFrame);
      const text = encodeSceneData({ at, frame: snapshot, presentation,
        worldRevision: segment.deltas.length });
      if (!append(text.length, () => segment.samples.push(decodeSceneData(text) as SceneSample))) return;
      last = at;
      if (lastFrame) inheritSharedFields([lastFrame, snapshot]);
      lastFrame = snapshot;
    },
    stop: () => { active = false; },
    active: () => active,
    report: () => structuredClone(report),
    bytes: () => bytes,
    reset: () => {
      report = { ...report, segments: [], truncated: false };
      bytes = encodeSceneData(report).length;
      active = false;
    }
  };
};

const validHeader = (report: SceneReplay) => Boolean(report) && report.kind === "settlers-full-scene" &&
  isFormat(report, FORMATS.sceneReplay) && Array.isArray(report.segments) && report.segments.length <= MAX_SEGMENTS &&
  Number.isFinite(report.sampleSeconds) && report.sampleSeconds >= MIN_SAMPLE_SECONDS &&
  Array.isArray(report.limits);

const validSample = (sample: SceneSample, previous: number, deltas: number) =>
  Number.isFinite(sample.at) && sample.at >= previous &&
  Number.isSafeInteger(sample.worldRevision) && sample.worldRevision >= 0 && sample.worldRevision <= deltas &&
  Boolean(sample.frame) && Number.isFinite(sample.frame.time) &&
  Boolean(sample.frame.camera) && Boolean(sample.frame.environment);

const validSegmentShape = (segment: SceneSegment) => typeof segment.world === "string" &&
  typeof segment.island === "string" && isNation(segment.nation) &&
  Array.isArray(segment.samples) && Array.isArray(segment.deltas);

const checkSegment = (segment: SceneSegment) => {
  if (!validSegmentShape(segment)) throw new Error("Invalid scene segment");
  let previous = -Infinity;
  for (const sample of segment.samples) {
    if (!validSample(sample, previous, segment.deltas.length)) throw new Error("Invalid scene frame");
    previous = sample.at;
  }
  for (const state of segment.deltas) {
    if (!Number.isFinite(state.at) || typeof state.data !== "string") throw new Error("Invalid scene world state");
  }
};

export const readSceneReplay = (text: string): SceneReplay => {
  const report = decodeSceneData(text) as SceneReplay;
  if (!validHeader(report)) throw new Error("Invalid scene replay header");
  for (const segment of report.segments) checkSegment(segment);
  return report;
};
