import { audioGestures } from "./audio-gesture";

interface AutoplayState { muted: boolean; paused: boolean; status: { kind: string } }
interface AutoplayOptions {
  allowed: () => boolean;
  gestures?: Pick<typeof audioGestures, "subscribe">;
  play: () => Promise<boolean>;
  state: () => AutoplayState;
}

/** A single startup request. Manual player actions cancel its retry; no playlist is changed here. */
export const createMusicAutoplay = ({ allowed, gestures = audioGestures, play, state }: AutoplayOptions) => {
  let cancelled = false, running = false;
  let unsubscribe: (() => void) | undefined;
  const clearGesture = () => { unsubscribe?.(); unsubscribe = undefined; };
  const cancel = () => { cancelled = true; clearGesture(); };
  const tryPlay = async () => {
    if (cancelled || running) return;
    if (!allowed() || state().muted) { cancel(); return; }
    running = true;
    clearGesture();
    const started = await play();
    running = false;
    if (cancelled || started) return;
    if (state().status.kind !== "autoplayBlocked") return;
    // Browser policy can require a fresh real gesture. Never fake one or repeatedly call play in a loop.
    unsubscribe = gestures.subscribe(() => { void tryPlay(); });
  };
  void tryPlay();
  return { cancel };
};
