import { describe, expect, it, vi } from "vitest";

import { MAP_AUDIO_LIMITS, type MapAudioAsset } from "../../island-of-settlers-shared/src/script/audio";
import { actionDef } from "../../island-of-settlers-shared/src/script/catalog/actions";
import { doStep, emptyScript, trigger } from "../../island-of-settlers-shared/tests/script-fixtures";
import {
  audioAssetName, audioPickerTabs, audioRefusalText, describeAudioRef, formatAudioDuration, initialAudioTabId,
  nextAudioAssetId, withUploadedAudio
} from "../src/app/map-editor/script/audio-picker-model";
import { createAudioPreview } from "../src/app/map-editor/script/audio-preview";
import { audioUploadMimeType, readAudioUpload } from "../src/app/map-editor/script/audio-upload";
import { EMPTY_SCOPE, slotSpec, summarizeValue } from "../src/app/map-editor/script/block-parts";
import { AUDIO_UPLOADS_TAB_ID } from "../src/app/map-editor/script/constants";
import { pickerTabs } from "../src/app/map-editor/script/slot-picker-model";
import { validateEditedScript } from "../src/app/map-editor/script/validation";

const HORN: MapAudioAsset = { data: "AAAA", durationSeconds: 2, id: "audio-1", kind: "sound", mimeType: "audio/ogg",
  name: "Horn" };
const MARCH: MapAudioAsset = { ...HORN, durationSeconds: 125, id: "audio-4", kind: "music", name: "Castle march" };
const context = { audioAssets: [HORN, MARCH], locale: "en", script: emptyScript() };
const slotOptions = { context, mode: "action" as const, scope: EMPTY_SCOPE, values: {} };

describe("audio picker model", () => {
  it("offers the music collections as tabs, then the map's uploads of the slot kind", () => {
    const tabs = audioPickerTabs("music", [HORN, MARCH], "", undefined);
    expect(tabs.map(tab => tab.label)).toEqual(["Roman", "Viking", "Japanese", "Nubian", "Chinese", "Persian", "Maya",
      "Indigenous", "Neutral", "Uploaded"]);
    expect(tabs.slice(0, 8).every(tab => tab.options.length === 10)).toBe(true);
    expect(tabs[8]!.options).toHaveLength(9);
    expect(tabs.at(-1)!.options).toEqual([{ detail: "2:05", key: "upload:audio-4", label: "Castle march",
      selected: false, uploaded: true, value: { assetId: "audio-4", kind: "upload" } }]);
    const sounds = audioPickerTabs("sound", [HORN, MARCH], "", undefined);
    expect(sounds.map(tab => [tab.label, tab.options.length])).toEqual([["Fanfares", 2], ["Nature", 8], ["Uploaded", 1]]);
  });

  it("filters by name, marks the stored value and opens on its tab", () => {
    const stored = { id: "music:harbour-lanterns", kind: "catalog" };
    const tabs = audioPickerTabs("music", [MARCH], "LANTERN", stored);
    const neutral = tabs.find(tab => tab.id === "music.neutral")!;
    expect(neutral.options.map(option => [option.label, option.detail, option.selected]))
      .toEqual([["Harbour Lanterns", "0:33", true]]);
    expect(tabs.at(-1)!.options).toEqual([]);
    expect(initialAudioTabId(tabs)).toBe("music.neutral");
    expect(initialAudioTabId(audioPickerTabs("music", [MARCH], "", { assetId: "audio-4", kind: "upload" })))
      .toBe(AUDIO_UPLOADS_TAB_ID);
    expect(initialAudioTabId(audioPickerTabs("music", [], "", undefined))).toBe("music.roman");
  });

  it("summarizes stored references and formats durations", () => {
    expect(describeAudioRef({ id: "sound:thunder", kind: "catalog" }, [])).toBe("Thunder");
    expect(describeAudioRef({ id: "sound:gone", kind: "catalog" }, [])).toBe("sound:gone");
    expect(describeAudioRef({ assetId: "audio-1", kind: "upload" }, [HORN])).toBe("Horn");
    expect(describeAudioRef({ assetId: "audio-9", kind: "upload" }, [HORN])).toBe("audio-9");
    expect([0.4, 59.6, 249.9].map(formatAudioDuration)).toEqual(["0:01", "1:00", "4:10"]);
  });

  it("types the playSound / playMusic slots as audio pickers with one tab", () => {
    const cue = slotSpec(actionDef("playSound").args[0]!, slotOptions);
    const track = slotSpec(actionDef("playMusic").args[0]!, slotOptions);
    expect(cue).toEqual({ audio: "sound", kind: "audio" });
    expect(track).toEqual({ audio: "music", kind: "audio" });
    expect(pickerTabs(track)).toEqual(["audio"]);
    expect(summarizeValue(cue, { assetId: "audio-1", kind: "upload" }, context)).toBe("Horn");
    expect(summarizeValue(track, { id: "music:harbour-lanterns", kind: "catalog" }, context)).toBe("Harbour Lanterns");
    expect(summarizeValue(track, undefined, context)).toBe("");
  });
});

describe("audio uploads", () => {
  it("numbers new assets after the highest id and labels them by file name", () => {
    expect(nextAudioAssetId([])).toBe("audio-1");
    expect(nextAudioAssetId([HORN, MARCH])).toBe("audio-5");
    expect(audioAssetName("War horn.final.ogg")).toBe("War horn.final");
    expect(audioAssetName("x".repeat(200) + ".mp3")).toHaveLength(MAP_AUDIO_LIMITS.nameLength);
  });

  it("accepts OGG and MP3 by type or extension only", () => {
    expect(audioUploadMimeType({ name: "a.bin", type: "audio/ogg; codecs=vorbis" })).toBe("audio/ogg");
    expect(audioUploadMimeType({ name: "a.MP3", type: "" })).toBe("audio/mpeg");
    expect(audioUploadMimeType({ name: "a.wav", type: "audio/wav" })).toBeNull();
  });

  it("reads a file into an asset and refuses the wrong format, an oversized or an undecodable file", async () => {
    const file = (name: string, bytes: number) => new File([new Uint8Array(bytes)], name);
    const twoSeconds = () => Promise.resolve(2);
    expect(await readAudioUpload(file("horn.ogg", 3), "sound", "audio-1", twoSeconds))
      .toEqual({ asset: { ...HORN, name: "horn" } });
    expect(await readAudioUpload(file("horn.wav", 3), "sound", "audio-1", twoSeconds))
      .toEqual({ refusal: "unsupportedFormat" });
    const duration = vi.fn(twoSeconds);
    expect(await readAudioUpload(file("big.ogg", MAP_AUDIO_LIMITS.sound.bytes + 1), "sound", "audio-1", duration))
      .toEqual({ refusal: "tooLarge" });
    expect(duration).not.toHaveBeenCalled();
    expect(await readAudioUpload(file("noise.mp3", 3), "music", "audio-1", () => Promise.resolve(null)))
      .toEqual({ refusal: "invalidAsset" });
  });

  it("adds an upload within the limits and words each refusal with the limits of the kind", () => {
    expect(withUploadedAudio([HORN], { ...HORN, id: "audio-2" })).toEqual({ assets: [HORN, { ...HORN, id: "audio-2" }] });
    expect(withUploadedAudio([], { ...HORN, durationSeconds: 16 })).toEqual({ refusal: "tooLong" });
    const full = Array.from({ length: MAP_AUDIO_LIMITS.assets }, (_, index) => ({ ...HORN, id: `audio-${index + 1}` }));
    expect(withUploadedAudio(full, { ...HORN, id: "audio-99" })).toEqual({ refusal: "tooManyAssets" });
    expect(audioRefusalText("tooLong", "sound")).toBe("The file is longer than 15 s.");
    expect(audioRefusalText("tooLarge", "music")).toBe("The file is larger than 1536 KB.");
    expect(audioRefusalText("totalTooLarge", "music"))
      .toBe("The map's uploaded audio would exceed 2048 KB in total.");
  });

  it("reports a script reference to a removed upload in the live validation", () => {
    const script = emptyScript({ triggers: [trigger("trigger-1", { actions: [
      doStep("s1", "playSound", { cue: { assetId: "audio-1", kind: "upload" } })] })] });
    const world = { cellsX: 64, scenario: undefined };
    expect(validateEditedScript({ ...world, audioAssets: [HORN] }, script).errors).toEqual([]);
    expect(validateEditedScript(world, script).errors.map(issue => issue.code)).toEqual(["unknownAudioAsset"]);
  });
});

describe("audio preview", () => {
  const fakeVoice = () => {
    const listeners = new Map<string, () => void>();
    return { emit: (type: string) => listeners.get(type)?.(),
      voice: { addEventListener: (type: string, listener: () => void) => { listeners.set(type, listener); },
        pause: vi.fn(), play: () => Promise.resolve() } };
  };

  it("plays one file at a time, reports its end and plays cues without a stop state", () => {
    const voices: ReturnType<typeof fakeVoice>[] = [];
    const cues = { dispose: vi.fn(), play: vi.fn(() => true) };
    const onEnd = vi.fn();
    const preview = createAudioPreview({ createVoice: () => {
      const created = fakeVoice();
      voices.push(created);
      return created.voice as never;
    }, cues, onEnd });
    expect(preview.play({ id: "a", kind: "file", name: "A", url: "/a.ogg" })).toBe(true);
    expect(preview.play({ id: "b", kind: "file", name: "B", url: "/b.ogg" })).toBe(true);
    expect(voices[0]!.voice.pause).toHaveBeenCalledTimes(1);
    voices[0]!.emit("ended");
    expect(onEnd).not.toHaveBeenCalled();
    voices[1]!.emit("ended");
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(preview.play({ cue: "cue:weather.thunder", kind: "cue", name: "Thunder" })).toBe(false);
    expect(cues.play).toHaveBeenCalledWith("cue:weather.thunder", 1);
    preview.dispose();
    expect(cues.dispose).toHaveBeenCalled();
  });
});
