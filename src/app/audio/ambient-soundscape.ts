import type { CameraState } from "../../render-common/camera-state";
import type { EnvironmentState } from "../../render-common/environment";
import type { WorldData } from "../../shared/world/world-data";
import type { SoundWorkerMessage } from "../../workers/sound-worker";
import type { SoundLayer } from "../settings/sound-settings";
import { audioGestures } from "./audio-gesture";
import type { CreatureSource } from "./creature-sources";
import {
  type AudioCategory,
  createSoundscapeGraph,
  type SoundscapeGraph
} from "./soundscape-graph";
import { computeLayerMix, getGust, type SoundConditions } from "./soundscape-mix";
import type { CreatureSoundKind } from "./synth/sound-bank";
import { scheduleThunder } from "./synth/thunder";
import { createWildlifeVoices } from "./wildlife-voices";
import {
  createSoundField,
  removeSoundTree,
  sampleSoundField,
  type SoundField
} from "./world-sound-field";

/** World sampling interval: the mix follows the camera four times a second. */
const UPDATE_MS = 250;

interface SoundscapeSettings {
  enabled: boolean;
  layersOff: Set<SoundLayer>;
  /** 0..1 across the environment bus. */
  masterVolume: number;
  volumes: Record<AudioCategory, number>;
}

interface SoundscapeOptions {
  camera: CameraState;
  /** Clock hour 0..24 (the environment state has no hour; the dawn chorus needs it). */
  getHour: () => number;
  settings: SoundscapeSettings;
  world: WorldData;
}

/** Slider position -> gain: a squared curve sounds even across the slider. */
const toGain = (volume: number) => volume * volume;

const startSynthWorker = (onMessage: (message: SoundWorkerMessage) => void) => {
  const worker = new Worker(new URL("../../workers/sound-worker.ts", import.meta.url), {
    type: "module"
  });
  worker.onmessage = (event: MessageEvent<SoundWorkerMessage>) => onMessage(event.data);
  worker.postMessage("render");
  return worker;
};

/**
 * The island's ambient soundscape: sea, river, leaves per tree species, rain and wildlife, all
 * synthesised (no audio files), mixed from what lies around the camera target. Nothing audio
 * related exists until the player switches sound on (that click is the gesture browsers ask
 * for); a stored "on" resumes on the first pointer or key press after load.
 */
export const createAmbientSoundscape = (options: SoundscapeOptions) => {
  const { camera, settings } = options;
  let environment: EnvironmentState | null = null;
  let context: AudioContext | null = null;
  let graph: SoundscapeGraph | null = null;
  let field: SoundField | null = null;
  let disposed = false;
  let updateInterval: number | undefined;
  let suspendTimer: number | undefined;
  let synthWorker: Worker | undefined;
  /** Trees felled so far (the field is built late, when sound first starts). */
  const felledTrees: number[] = [];
  let lastUpdate = 0;
  const voices = createWildlifeVoices((request) => graph?.playCall(request));

  const handleSynth = (message: SoundWorkerMessage) => {
    if (disposed || !graph) return;
    if (message.kind === "loop") {
      graph.setLoop(message.layer, message.samples);
      return;
    }
    voices.setCalls(message.creature, message.variants.map(graph.toBuffer));
  };

  const readConditions = (state: EnvironmentState): SoundConditions => ({
    daylight: state.daylight,
    hour: options.getHour(),
    rain: state.rain,
    snow: state.snow,
    wind: Math.hypot(state.windX, state.windZ),
    zoom: camera.zoom
  });

  const update = () => {
    if (disposed || !graph || !field || !environment || context?.state !== "running") return;
    const now = context.currentTime;
    const seconds = Math.min(1, lastUpdate > 0 ? now - lastUpdate : UPDATE_MS / 1000);
    lastUpdate = now;
    const sample = sampleSoundField(field, camera);
    const conditions = readConditions(environment);
    const mix = computeLayerMix(sample, conditions, settings.layersOff);
    graph.applyMix(mix, getGust(now, conditions.wind));
    if (settings.layersOff.has("wildlife")) return;
    voices.updateForest(seconds, mix.forestBirdsong, sample.pan.broadleaf);
    voices.updateCreatures(seconds, camera, conditions);
  };

  /** Builds everything once, inside a user gesture: context, graph, field, synth worker. */
  const start = () => {
    if (disposed || context) return;
    context = new AudioContext({ latencyHint: "playback" });
    graph = createSoundscapeGraph(context);
    graph.setVolume("environment", toGain(settings.volumes.environment * settings.masterVolume));
    graph.setMasterOn(true);
    field = createSoundField(options.world);
    for (const tree of felledTrees) removeSoundTree(field, options.world, tree);
    synthWorker = startSynthWorker(handleSynth);
    updateInterval = window.setInterval(update, UPDATE_MS);
  };

  /** Browsers only start audio after a user gesture; before it nothing is created. */
  let gestureSeen = audioGestures.hasSeenGesture();
  let unsubscribeGesture: (() => void) | undefined;

  const resume = () => {
    if (disposed || !settings.enabled || !gestureSeen || document.hidden) return;
    start();
    graph?.setMasterOn(true);
    void context?.resume();
  };

  const suspend = () => {
    if (disposed || !context || !graph) return;
    graph.setMasterOn(false);
    const current = context;
    if (suspendTimer !== undefined) window.clearTimeout(suspendTimer);
    suspendTimer = window.setTimeout(() => {
      suspendTimer = undefined;
      if (!settings.enabled || document.hidden) void current.suspend();
    }, 400);
  };

  const unlock = () => {
    unsubscribeGesture?.();
    unsubscribeGesture = undefined;
    gestureSeen = true;
    resume();
  };
  const unlockOnGesture = () => {
    unsubscribeGesture?.();
    if (audioGestures.hasSeenGesture()) { unlock(); return; }
    unsubscribeGesture = audioGestures.subscribe(unlock);
  };
  const onVisibility = () => (document.hidden ? suspend() : resume());

  if (settings.enabled) unlockOnGesture();
  document.addEventListener("visibilitychange", onVisibility);

  return {
    /** Releases the synth worker, audio context, interval, timers and global input listeners. */
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (updateInterval !== undefined) window.clearInterval(updateInterval);
      updateInterval = undefined;
      if (suspendTimer !== undefined) window.clearTimeout(suspendTimer);
      suspendTimer = undefined;
      unsubscribeGesture?.();
      unsubscribeGesture = undefined;
      document.removeEventListener("visibilitychange", onVisibility);
      synthWorker?.terminate();
      synthWorker = undefined;
      felledTrees.length = 0;
      graph = null;
      field = null;
      environment = null;
      const closing = context;
      context = null;
      if (closing) void closing.close().catch(() => undefined);
    },
    /** Borrowed only for presentation thunder; null until the first gesture creates the context. */
    audioContext: () => disposed ? null : context,
    /** Borrowed environment bus; null while sound is off. */
    environmentBus: () => disposed ? null : graph?.environmentBus() ?? null,
    audioEnabled: () => settings.enabled,
    audioLevels: () => ({ environment: settings.volumes.environment, master: settings.masterVolume }),
    /** Lists creatures (birds, land animals) for the in-view calls; see creature-sources. */
    addCreatureSource: (source: CreatureSource) => voices.addSource(source),
    /** A creature calls now at a world point (event hook for animals: a startled deer). */
    emitCreatureSound: (kind: CreatureSoundKind, x: number, z: number) => {
      if (!disposed && graph && !settings.layersOff.has("wildlife")) voices.emit(camera, kind, x, z);
    },
    /** A tree was felled: its leaves no longer rustle. */
    onTreeFelled: (tree: number) => {
      if (disposed) return;
      felledTrees.push(tree);
      if (field) removeSoundTree(field, options.world, tree);
    },
    /** Must be called from a user gesture when switching on (creates the audio context). */
    setEnabled: (enabled: boolean) => {
      if (disposed) return;
      settings.enabled = enabled;
      gestureSeen = true;
      if (enabled) resume();
      else suspend();
    },
    setLayer: (layer: SoundLayer, on: boolean) => {
      if (disposed) return;
      if (on) settings.layersOff.delete(layer);
      else settings.layersOff.add(layer);
      update();
    },
    /** Master 0..1 for every island sound; music applies the same level in its own service. */
    setMasterVolume: (volume: number) => {
      if (disposed) return;
      settings.masterVolume = volume;
      graph?.setVolume("environment", toGain(settings.volumes.environment * volume));
    },
    /** Volume 0..1 of a category; stored even while sound is off. */
    setVolume: (category: AudioCategory, volume: number) => {
      if (disposed) return;
      settings.volumes[category] = volume;
      graph?.setVolume(category, toGain(volume * settings.masterVolume));
    },
    /** A short filtered noise rumble plus a low sine body, scaled by the master/environment levels. */
    playThunder: () => {
      if (disposed || !context || !settings.enabled) return;
      void context.resume().catch(() => undefined);
      // Thunder follows the flash by a short, slightly varied delay, as distance would.
      scheduleThunder(context, context.currentTime + .12 + Math.random() * .28,
        settings.volumes.environment * settings.masterVolume);
    },
    /** Pass-through for the environment update: the soundscape reads rain, snow, wind, daylight. */
    trackEnvironment: (state: EnvironmentState) => {
      if (!disposed) environment = state;
      return state;
    }
  };
};
