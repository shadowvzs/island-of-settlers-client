import { describe, expect, it, vi } from "vitest";

import { createAudioGestureOwner } from "../src/app/audio/audio-gesture";
import { createMusicAutoplay } from "../src/app/audio/music-autoplay";

const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
const harness = () => {
  const listeners = new Map<string, (event: { isTrusted?: boolean; repeat?: boolean }) => void>();
  const target = {
    addEventListener: vi.fn((type: string, listener: (event: { isTrusted?: boolean }) => void) => listeners.set(type, listener)),
    removeEventListener: vi.fn((type: string) => listeners.delete(type))
  };
  const gestures = createAudioGestureOwner(target);
  const send = (trusted = true) => listeners.get("pointerdown")?.({ isTrusted: trusted });
  return { gestures, listeners, send, target };
};

describe("national music startup", () => {
  it("leaves no capture listeners after fifty cancelled blocked startups", async () => {
    const { gestures, listeners, target } = harness();
    for (let cycle = 0; cycle < 50; cycle++) {
      const automatic = createMusicAutoplay({ allowed: () => true, gestures,
        play:async()=>false,
        state:()=>({ muted:false, paused:true, status:{ kind:"autoplayBlocked" } }) });
      await settle();
      automatic.cancel();
    }
    gestures.dispose();
    expect(listeners.size).toBe(0);
    expect(target.addEventListener.mock.calls.length).toBe(target.removeEventListener.mock.calls.length);
  });
  it("tries once on load and needs no gesture when the browser allows playback", async () => {
    const { gestures, listeners } = harness();
    const play = vi.fn(async () => true);
    createMusicAutoplay({ allowed: () => true, gestures, play,
      state: () => ({ muted: false, paused: false, status: { kind: "track" } }) });
    await settle();
    expect(play).toHaveBeenCalledOnce();
    gestures.dispose();
    expect(listeners.size).toBe(0);
  });

  it("retries a browser refusal on a trusted gesture, sharing only one capture pair", async () => {
    const { gestures, listeners, send, target } = harness();
    const play = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    createMusicAutoplay({ allowed: () => true, gestures, play,
      state: () => ({ muted: false, paused: true, status: { kind: "autoplayBlocked" } }) });
    await settle();
    expect(listeners.size).toBe(2);
    expect(target.addEventListener).toHaveBeenCalledTimes(2);
    send(false); await settle(); expect(play).toHaveBeenCalledOnce();
    send(); await settle(); expect(play).toHaveBeenCalledTimes(2);
    expect(listeners.size).toBe(0);
    gestures.dispose();
  });

  it("honours zero/disabled audio and manual stop or playlist selection before an unlock", async () => {
    for (const allowed of [false, true]) {
      const { gestures, listeners, send } = harness();
      const play = vi.fn(async () => false);
      const automatic = createMusicAutoplay({ allowed: () => allowed, gestures, play,
        state: () => ({ muted: false, paused: true, status: { kind: "autoplayBlocked" } }) });
      await settle();
      automatic.cancel(); send(); await settle();
      expect(play).toHaveBeenCalledTimes(allowed ? 1 : 0);
      gestures.dispose(); expect(listeners.size).toBe(0);
    }
  });

  it("does not retry muted or unsupported files and checks audio policy again at the gesture", async () => {
    const { gestures, send } = harness();
    let allowed = true;
    const play = vi.fn(async () => false);
    createMusicAutoplay({ allowed: () => allowed, gestures, play,
      state: () => ({ muted: false, paused: true, status: { kind: "autoplayBlocked" } }) });
    await settle(); allowed = false; send(); await settle();
    expect(play).toHaveBeenCalledOnce();
    const unsupported = vi.fn(async () => false);
    createMusicAutoplay({ allowed: () => true, gestures, play: unsupported,
      state: () => ({ muted: false, paused: true, status: { kind: "unplayable" } }) });
    await settle(); send(); await settle(); expect(unsupported).toHaveBeenCalledOnce();
    const muted = vi.fn(async () => true);
    createMusicAutoplay({ allowed: () => true, gestures, play: muted,
      state: () => ({ muted: true, paused: true, status: { kind: "idle" } }) });
    await settle(); expect(muted).not.toHaveBeenCalled(); gestures.dispose();
  });
});
