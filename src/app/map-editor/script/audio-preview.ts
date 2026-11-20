import { createAudioCuePlayer } from "../../audio/audio-cues";
import type { ResolvedAudio } from "../../audio/audio-refs";

/** The parts of an audio element the preview uses (a fake one serves the tests). */
export type PreviewVoice = Pick<HTMLAudioElement, "addEventListener" | "pause" | "play">;

export interface AudioPreviewOptions {
  createVoice?: (url: string) => PreviewVoice;
  cues?: Pick<ReturnType<typeof createAudioCuePlayer>, "dispose" | "play">;
  /** The playing file ended or failed. */
  onEnd: () => void;
}

/**
 * The editor's audio preview: one file at a time on its own element (never the game's music player), or a
 * synthesized cue. The button click is the user gesture browsers ask for.
 */
export const createAudioPreview = (options: AudioPreviewOptions) => {
  const createVoice = options.createVoice ?? (url => new Audio(url));
  const cues = options.cues ?? createAudioCuePlayer();
  let voice: PreviewVoice | null = null;
  const stop = () => {
    voice?.pause();
    voice = null;
  };
  return {
    dispose: () => {
      stop();
      cues.dispose();
    },
    /** True while a file plays on (a cue plays out by itself and needs no stop). */
    play: (audio: ResolvedAudio) => {
      stop();
      if (audio.kind === "cue") {
        cues.play(audio.cue, 1);
        return false;
      }
      const started = createVoice(audio.url);
      const end = () => {
        if (voice !== started) return;
        voice = null;
        options.onEnd();
      };
      voice = started;
      started.addEventListener("ended", end);
      started.addEventListener("error", end);
      void started.play().catch(end);
      return true;
    },
    stop
  };
};
