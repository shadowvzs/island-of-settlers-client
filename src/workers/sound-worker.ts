import {
  CREATURE_SOUND_KINDS,
  type CreatureSoundKind,
  LOOP_LAYERS,
  type LoopLayer,
  renderCallVariants,
  renderLoop} from "../app/audio/synth/sound-bank";

export type SoundWorkerMessage =
  | { kind: "loop"; layer: LoopLayer; samples: Float32Array }
  | { kind: "calls"; creature: CreatureSoundKind; variants: Float32Array[] };

const scope = self as unknown as DedicatedWorkerGlobalScope;

/**
 * Synthesises every ambient bed and creature call off the main thread (a few hundred ms of
 * DSP), posting each one as soon as it is ready so the soundscape fades in layer by layer.
 */
scope.onmessage = () => {
  for (const layer of LOOP_LAYERS) {
    const samples = renderLoop(layer);
    scope.postMessage({ kind: "loop", layer, samples }, [samples.buffer as ArrayBuffer]);
  }
  for (const creature of CREATURE_SOUND_KINDS) {
    const variants = renderCallVariants(creature);
    const buffers = variants.map((samples) => samples.buffer as ArrayBuffer);
    scope.postMessage({ creature, kind: "calls", variants }, buffers);
  }
  scope.close();
};
