import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { audioLevels } from "../src/app/audio/audio-levels";
import type { MusicTrack } from "../src/app/audio/music-catalog";
import {
  createBrowserMusicPlayer,
  createMusicPlayerService,
  type MusicAudio
} from "../src/app/audio/music-player-service";
import { createThrottledPublisher, MUSIC_PROGRESS_INTERVAL_MS } from "../src/app/audio/music-player-store";

/** Enough of HTMLAudioElement for the service: state fields plus the events it listens to. */
class FakeAudio extends EventTarget {
  currentTime = 0;
  duration = Number.NaN;
  ended = false;
  muted = false;
  paused = true;
  rejectPlay = false;
  src = "";
  volume = .35;
  load() { this.currentTime = 0; this.emit("emptied"); }
  pause() {
    if (this.paused) return;
    this.paused = true; this.emit("pause");
  }
  play() {
    if (this.rejectPlay) return Promise.reject(new Error("autoplay"));
    this.paused = false; this.ended = false; this.emit("play");
    return Promise.resolve();
  }
  removeAttribute() { this.src = ""; }
  emit(type: string) { this.dispatchEvent(new Event(type)); }
  setVolume(volume: number) { this.volume = volume; this.emit("volumechange"); }
  finish() { this.paused = true; this.ended = true; this.currentTime = this.duration; this.emit("ended"); }
}

const track = (collection: MusicTrack["collection"], name: string): MusicTrack => ({
  collection, filename: `${name}.ogg`, name, url: `/${name}.ogg`
});
const bundled = [track("roman", "r1"), track("roman", "r2"), track("viking", "v1"), track("neutral", "n1")];

const setup = (collection = "roman") => {
  const audio = new FakeAudio();
  const revoked: string[] = [];
  const service = createMusicPlayerService({
    audio: audio as unknown as MusicAudio, bundled, collection,
    createObjectUrl: file => `blob:${file.name}`, revokeObjectUrl: url => revoked.push(url)
  });
  const publications = vi.fn();
  service.store.subscribe(publications);
  const state = () => service.store.getSnapshot();
  return { audio, publications, revoked, service, state };
};

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("throttled publisher", () => {
  it("publishes the first request at once, then at most once per interval with a trailing update", () => {
    const publish = vi.fn();
    const publisher = createThrottledPublisher(publish, 250);
    publisher.request();
    expect(publish).toHaveBeenCalledTimes(1);
    for (let step = 0; step < 10; step++) { vi.advanceTimersByTime(20); publisher.request(); }
    expect(publish).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(50);
    expect(publish).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1000);
    expect(publish).toHaveBeenCalledTimes(2);
  });
  it("lets an immediate publication replace a pending trailing one", () => {
    const publish = vi.fn();
    const publisher = createThrottledPublisher(publish, 250);
    publisher.request(); publisher.request();
    publisher.now();
    expect(publish).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1000);
    expect(publish).toHaveBeenCalledTimes(2);
  });
});

describe("music player service", () => {
  it("reuses the BFCache page player and releases page/settings ownership on terminal pagehide", () => {
    const page = new EventTarget();
    const removed = vi.spyOn(page, "removeEventListener");
    const unsubscribe = vi.fn();
    vi.spyOn(audioLevels, "subscribe").mockReturnValue(unsubscribe);
    const audios: FakeAudio[] = [];
    vi.stubGlobal("window", page);
    vi.stubGlobal("document", { createElement: () => {
      const audio = Object.assign(new FakeAudio(), { setAttribute: vi.fn() });
      audios.push(audio);
      return audio;
    } });
    const hide = (persisted: boolean) => {
      const event = new Event("pagehide");
      Object.defineProperty(event, "persisted", { value: persisted });
      page.dispatchEvent(event);
    };
    const first = createBrowserMusicPlayer("roman");
    hide(true);
    expect(createBrowserMusicPlayer("viking")).toBe(first);
    expect(unsubscribe).not.toHaveBeenCalled();
    hide(false);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(removed).toHaveBeenCalledTimes(1);
    expect(audios[0]!.src).toBe("");
    const second = createBrowserMusicPlayer("viking");
    expect(second).not.toBe(first);
    expect(second.store.getSnapshot().collection).toBe("viking");
    second.dispose();
    hide(false);
    hide(false);
    expect(unsubscribe).toHaveBeenCalledTimes(2);
    expect(removed).toHaveBeenCalledTimes(2);
    expect(audios).toHaveLength(2);
  });
  it("starts on the nation's own collection, repeat on, loop off, first track loaded", () => {
    const { audio, state } = setup("viking");
    expect(state().tracks.map(entry => entry.name)).toEqual(["v1"]);
    expect(state()).toMatchObject({ collection: "viking", currentIndex: 0, loopCurrent: false,
      paused: true, repeatPlaylist: true, status: { kind: "track", track: "v1" }, volume: .35 });
    expect(audio.src).toBe("/v1.ogg");
  });
  it("publishes play and pause at once but progress at most four times per second", () => {
    const { audio, publications, service, state } = setup();
    publications.mockClear();
    service.togglePlayback();
    expect(state().paused).toBe(false);
    expect(publications).toHaveBeenCalledTimes(1);
    publications.mockClear();
    audio.duration = 60;
    for (let tick = 1; tick <= 20; tick++) {
      audio.currentTime = tick * .05; audio.emit("timeupdate"); vi.advanceTimersByTime(50);
    }
    expect(publications.mock.calls.length).toBeLessThanOrEqual(1000 / MUSIC_PROGRESS_INTERVAL_MS + 1);
    vi.advanceTimersByTime(MUSIC_PROGRESS_INTERVAL_MS);
    expect(state().currentTime).toBe(1);
    service.togglePlayback();
    expect(state().paused).toBe(true);
  });
  it("wraps next/previous and keeps playing the new track", () => {
    const { service, state } = setup();
    service.previous();
    expect(state()).toMatchObject({ currentIndex: 1, paused: false, status: { kind: "track", track: "r2" } });
    service.next();
    expect(state().currentIndex).toBe(0);
  });
  it("advances, loops and repeats on ended per the playlist policy", () => {
    const { audio, service, state } = setup();
    service.selectTrack(1); service.playSelected(); audio.duration = 10;
    audio.finish();
    expect(state()).toMatchObject({ currentIndex: 0, paused: false });
    service.toggleRepeat(); service.selectTrack(1); audio.finish();
    expect(state()).toMatchObject({ currentIndex: 1, paused: true, repeatPlaylist: false });
    service.toggleLoop(); service.playSelected(); audio.finish();
    expect(state()).toMatchObject({ currentIndex: 1, loopCurrent: true, paused: false });
  });
  it("stops at zero, clamps seeks and unmutes when the volume rises", () => {
    const { audio, service, state } = setup();
    service.togglePlayback(); audio.duration = 30; audio.currentTime = 12;
    service.stop();
    expect(state()).toMatchObject({ currentTime: 0, paused: true });
    service.seek(99);
    expect(state().currentTime).toBe(30);
    service.toggleMute(); audio.emit("volumechange");
    expect(state().muted).toBe(true);
    service.setVolume(.5); audio.emit("volumechange");
    expect(state()).toMatchObject({ muted: false, volume: .5 });
  });
  it("keeps the playing state when the collection changes and reports a refused autoplay", async () => {
    const { audio, service, state } = setup();
    service.togglePlayback();
    service.selectCollection("all");
    expect(state()).toMatchObject({ collection: "all", currentIndex: 0, paused: false });
    expect(state().tracks).toHaveLength(bundled.length);
    service.stop(); audio.rejectPlay = true;
    service.togglePlayback();
    await Promise.resolve(); await Promise.resolve();
    expect(state().status).toEqual({ kind: "autoplayBlocked", track: "r1" });
  });
  it("queues local files, shows them in All music and releases them on page hide", () => {
    const { revoked, service, state } = setup();
    service.selectCollection("local");
    expect(state().status).toEqual({ kind: "emptyPlaylist" });
    service.addLocalFiles([new File(["a"], "one.wav"), new File(["b"], "two.wav")]);
    expect(state().collection).toBe("local");
    expect(state().tracks.map(entry => entry.url)).toEqual(["blob:one.wav", "blob:two.wav"]);
    service.selectCollection("all");
    expect(state().tracks).toHaveLength(bundled.length + 2);
    service.handlePageHide(true);
    expect(revoked).toEqual([]);
    service.handlePageHide(false);
    expect(revoked).toEqual(["blob:one.wav", "blob:two.wav"]);
  });
  it("reports an unplayable source, but not the error of a cleared one", () => {
    const { audio, service, state } = setup();
    audio.emit("error");
    expect(state().status).toEqual({ kind: "unplayable" });
    service.selectCollection("local");
    audio.emit("error");
    expect(state().status).toEqual({ kind: "emptyPlaylist" });
  });
  it("retains BFCache playback resources, then releases every listener, timer and local URL once", () => {
    for (let cycle = 0; cycle < 50; cycle++) {
      const { audio, publications, revoked, service, state } = setup();
      const removed = vi.spyOn(audio, "removeEventListener");
      service.addLocalFiles([new File(["audio"], `local-${cycle}.wav`)]);
      service.playSelected();
      service.handlePageHide(true);
      expect(audio.paused).toBe(true);
      expect(audio.src).toBe(`blob:local-${cycle}.wav`);
      expect(revoked).toEqual([]);
      expect(removed).not.toHaveBeenCalled();
      audio.emit("timeupdate");
      expect(vi.getTimerCount()).toBe(1);
      service.handlePageHide(false);
      service.dispose();
      expect(removed.mock.calls.map(([event]) => event).sort()).toEqual([
        "durationchange", "emptied", "ended", "error", "loadedmetadata", "pause", "play", "timeupdate",
        "volumechange"
      ]);
      expect(vi.getTimerCount()).toBe(0);
      expect(revoked).toEqual([`blob:local-${cycle}.wav`]);
      expect(audio.src).toBe("");
      expect(state().tracks).toEqual([]);
      publications.mockClear();
      for (const [event] of removed.mock.calls) audio.emit(event);
      service.next();
      service.addLocalFiles([new File(["unused"], "late.wav")]);
      vi.advanceTimersByTime(1000);
      expect(publications).not.toHaveBeenCalled();
      expect(audio.src).toBe("");
    }
  });
  it.each([true, false])("ignores a late play result after disposal (resolved=%s)", async resolved => {
    const { audio, publications, service } = setup();
    let finish!: () => void;
    vi.spyOn(audio, "play").mockImplementation(() => new Promise<void>((resolve, reject) => {
      finish = () => { if (resolved) resolve(); else reject(new Error("late autoplay")); };
    }));
    const result = service.playAutomatically();
    service.dispose();
    publications.mockClear();
    finish();
    expect(await result).toBe(false);
    expect(await service.playAutomatically()).toBe(false);
    expect(publications).not.toHaveBeenCalled();
    expect(audio.play).toHaveBeenCalledTimes(1);
  });
  it("keeps a decode error when the same failed play promise rejects afterward", async () => {
    const { audio, service, state } = setup();
    audio.rejectPlay = true;
    service.playSelected();
    audio.emit("error");
    await Promise.resolve();
    expect(state().status).toEqual({ kind: "unplayable" });
  });
});

describe("map script music cues", () => {
  it("plays a bundled track by id with the loop mode and adds an uploaded track once", () => {
    const { audio, service, state } = setup();
    expect(service.playCueTrack({ id: "v1", name: "v1", url: "/v1.ogg" }, true)).toBe(true);
    expect(state().collection).toBe("all");
    expect(audio.src).toBe("/v1.ogg");
    expect(state().loopCurrent).toBe(true);
    const upload = { id: "upload:audio-1", name: "My march", url: "data:audio/ogg;base64,AAAA" };
    expect(service.playCueTrack(upload, false)).toBe(true);
    expect(service.playCueTrack(upload, false)).toBe(true);
    expect(audio.src).toBe(upload.url);
    expect(audio.paused).toBe(false);
    expect(state().loopCurrent).toBe(false);
    expect(state().tracks.filter(track => track.name === "My march")).toHaveLength(1);
    expect(state().tracks).toHaveLength(bundled.length + 1);
  });

  it("returns the cue gain to full when the player picks music themselves", () => {
    const { audio, service } = setup();
    service.setVolume(.8);
    service.setCueGain(.25);
    expect(audio.volume).toBeCloseTo(.2);
    service.next();
    expect(audio.volume).toBeCloseTo(.8);
  });
});

