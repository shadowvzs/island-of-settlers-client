import { describe, expect, it } from "vitest";

import { mapScriptHash } from "../../island-of-settlers-shared/src/script/hash";
import { plantTrees } from "../../island-of-settlers-shared/tests/script-fixtures";
import { compressBytes, decompressBytes } from "../src/shared/world/save/map-bytes";
import { MAP_PREFIX_BYTES, MapFileError } from "../src/shared/world/save/map-format";
import { readMapFile } from "../src/shared/world/save/map-reader";
import { type MapSaveInput, writeMapFile } from "../src/shared/world/save/map-writer";
import type { WorldData } from "../src/shared/world/world-data";
import { SMALL_EDITOR_WORLD } from "./editor-spots";
import { cachedWorld, preloadWorlds } from "./helpers/cached-worlds";

preloadWorlds(SMALL_EDITOR_WORLD);

const INPUT: MapSaveInput = { animals: [], name: "Scripted", savedAt: 1_700_000_000_000, source: "test" };

/** The JSON header of a gzip map file. */
const readHeader = async (file: Uint8Array) => {
  const payload = await decompressBytes(file.subarray(MAP_PREFIX_BYTES), "gzip");
  const length = new DataView(payload.buffer).getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(payload.subarray(4, 4 + length)));
  return { header, length, payload };
};

/** The file with its JSON header changed (the payload zipped again). */
const rewriteHeader = async (file: Uint8Array, change: (header: Record<string, unknown>) => void) => {
  const { header, length, payload } = await readHeader(file);
  change(header);
  const text = new TextEncoder().encode(JSON.stringify(header));
  const next = new Uint8Array(4 + text.length + payload.length - 4 - length);
  new DataView(next.buffer).setUint32(0, text.length, true);
  next.set(text, 4);
  next.set(payload.subarray(4 + length), 4 + text.length);
  return new Uint8Array([...file.subarray(0, MAP_PREFIX_BYTES), ...(await compressBytes(next, "gzip"))]);
};

const withScript = (world: WorldData) => ({ ...world, script: plantTrees() });

describe("map script in the map file header (TRG1)", () => {
  const world = cachedWorld(SMALL_EDITOR_WORLD);

  it("writes no script fields for a map without a script (bytes unchanged)", async () => {
    const plain = await writeMapFile(world, INPUT, { codec: "gzip" });
    const { header } = await readHeader(plain);
    expect(Object.keys(header).filter(key => key.startsWith("script"))).toEqual([]);
    const explicit = await writeMapFile({ ...world, script: undefined }, INPUT, { codec: "gzip" });
    expect(explicit).toEqual(plain);
    expect((await readMapFile(plain)).world.script).toBeUndefined();
  });

  it("round-trips the script with its canonical hash; the loaded script is frozen", async () => {
    const scripted = withScript(world);
    const file = await writeMapFile(scripted, INPUT, { codec: "gzip" });
    const { header } = await readHeader(file);
    expect(header.scriptHash).toBe(mapScriptHash(scripted.script));
    expect(header).not.toHaveProperty("scriptReadsEnvironment");
    const loaded = (await readMapFile(file)).world.script!;
    expect(loaded).toEqual(scripted.script);
    expect(Object.isFrozen(loaded.quests.quests)).toBe(true);
    expect(mapScriptHash(loaded)).toBe(header.scriptHash);
    const again = await writeMapFile((await readMapFile(file)).world, INPUT, { codec: "gzip" });
    expect((await readHeader(again)).header.scriptHash).toBe(header.scriptHash);
  });

  it("refuses an edited script, a wrong hash and a hash without a script", async () => {
    const file = await writeMapFile(withScript(world), INPUT, { codec: "gzip" });
    const edits: ((header: Record<string, unknown>) => void)[] = [
      header => { (header.script as { revision: number }).revision = 5; },
      header => { header.scriptHash = "0".repeat(64); },
      header => { delete header.script; },
      header => { (header.script as { version: number }).version = 2; }
    ];
    for (const edit of edits) {
      const reading = readMapFile(await rewriteHeader(file, edit));
      await expect(reading).rejects.toBeInstanceOf(MapFileError);
      await expect(reading).rejects.toThrow(/damaged\. \(script/);
    }
  });

  it("stores uploaded map audio beside the script, outside its hash, and refuses a damaged list", async () => {
    const asset = { data: "AAAA", durationSeconds: 2, id: "audio-1", kind: "sound" as const,
      mimeType: "audio/ogg" as const, name: "Horn" };
    const scripted = withScript(world);
    const plain = await writeMapFile(scripted, INPUT, { codec: "gzip" });
    expect(await writeMapFile({ ...scripted, audioAssets: [] }, INPUT, { codec: "gzip" })).toEqual(plain);
    const file = await writeMapFile({ ...scripted, audioAssets: [asset] }, INPUT, { codec: "gzip" });
    const { header } = await readHeader(file);
    expect(header.audioAssets).toEqual([asset]);
    expect(header.scriptHash).toBe((await readHeader(plain)).header.scriptHash);
    expect((await readMapFile(file)).world.audioAssets).toEqual([asset]);
    expect((await readMapFile(plain)).world.audioAssets).toBeUndefined();
    const damaged = await rewriteHeader(file, changed => {
      changed.audioAssets = [{ ...asset, mimeType: "audio/wav" }];
    });
    await expect(readMapFile(damaged)).rejects.toThrow(MapFileError);
  });
});
