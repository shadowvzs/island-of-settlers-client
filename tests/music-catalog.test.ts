import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { musicEntries } from "@shared/catalog";
import { describe, expect, it } from "vitest";

import renderCatalog from "../assets/audio/midi/catalog.json";
import { bundledMusicTracks, MUSIC_COLLECTIONS, musicForCollection } from "../src/app/audio/music-catalog";

describe("Village Tales music collections", () => {
  it("keeps each of the eight nations separate from the neutral collection", () => {
    const tracks = bundledMusicTracks();
    const nations = ["roman", "viking", "nubian", "japanese", "chinese", "persian", "maya", "indigenous"];
    for (const nation of nations) {
      expect(MUSIC_COLLECTIONS.some(collection => collection.value === nation)).toBe(true);
      const selected = musicForCollection(tracks, nation);
      expect(selected.filter(track => track.collection === nation)).toHaveLength(10);
      expect(selected.filter(track => track.collection === "neutral")).toHaveLength(0);
      expect(selected.every(track => track.collection === nation)).toBe(true);
      expect(selected.every(track => track.name && track.url && track.filename?.endsWith(".ogg"))).toBe(true);
    }
    expect(tracks).toHaveLength(89);
    expect(musicForCollection(tracks, "neutral")).toHaveLength(9);
  });

  it("builds the player's list from the shared audio catalog: same entries, names and order, no other source", () => {
    const tracks = bundledMusicTracks();
    expect(tracks.map(track => ({ collection: track.collection, id: track.filename?.replace(/\.ogg$/, ""),
      name: track.name }))).toEqual(musicEntries().map(entry => ({
      collection: entry.music.collection, id: entry.key, name: entry.text.name.en })));
    expect(musicEntries().every(entry => entry.music.type === "music" && entry.text.name.key)).toBe(true);
    expect(tracks.at(-1)?.name).toBe("Harbour Lanterns");
    expect(tracks[0]?.name).toBe("A Kite above the Watermill");
    const sources = (folder: string): string[] => readdirSync(folder).flatMap(name => {
      const path = join(folder, name);
      if (statSync(path).isDirectory()) return sources(path);
      return /\.tsx?$/.test(name) ? [path] : [];
    });
    const importers = sources(join(import.meta.dirname, "../src"))
      .filter(path => /midi\/catalog\.json|assets\/audio\/[^"'*]+\.ogg/.test(readFileSync(path, "utf8")));
    expect(importers.map(path => path.split("/src/")[1])).toEqual([]);
  });

  it("lists every rendered track of the MIDI pipeline in the shared catalog, in its order", () => {
    const rendered = renderCatalog.tracks.map(track => ({
      collection: track.collection, id: `music:${track.id}`, path: `audio/midi/${track.file}`, seconds: track.seconds,
      title: track.title
    }));
    const listed = musicEntries().filter(entry => entry.key !== "harbour-lanterns").map(entry => ({
      collection: entry.music.collection, id: entry.id,
      path: entry.music.source.kind === "file" ? entry.music.source.file.path : "",
      seconds: entry.music.durationSeconds, title: entry.text.name.en
    }));
    expect(listed).toEqual(rendered);
  });
});
