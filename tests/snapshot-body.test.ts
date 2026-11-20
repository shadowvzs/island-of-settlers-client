import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import type { MapBase, MapBases } from "../../island-of-settlers-shared/src/save-map-delta";
import { addColonyRecord, emptyArchipelago } from "../src/shared/settlement/archipelago";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import type { IslandKey } from "../src/shared/settlement/game-save-rows";
import { createSnapshotBodyBuilder } from "../src/app/save-store/snapshot-body";

interface BodyIsland { key: string; save?: { data: { settlement: { buildings: { inventory: { logs: number } }[] } } };
  unchanged?: string }
interface Body { islands: BodyIsland[]; mapBases?: { catalogue?: true; hash: string; key: string; map?: string }[] }

const gameMap = () => {
  const header = Buffer.from(JSON.stringify({ seed: 1, cellsX: 8, cellsZ: 8,
    chunks: [{ name: "heights", type: "f32", length: 81 }] }));
  const length = Buffer.alloc(4); length.writeUInt32LE(header.length);
  return Buffer.concat([Buffer.from([73, 79, 83, 77, 2, 0, 0, 0]),
    gzipSync(Buffer.concat([length, header, Buffer.alloc(81 * 4)]))]).toString("base64");
};
const island = (logs: number): GameSaveV1 => ({ format: "island-settlers-game", map: gameMap(),
  progress: { fog: { length: 0, packed: "" }, surveyed: [] }, savedAt: 10,
  settlement: { buildings: [{ inventory: { logs } }], world: { cellsX: 8, cellsZ: 8, seed: 1 } } as never, version: 4 });

/** An archipelago game: a live colony 1 plus home, colony 2 and colony 3 filed. */
const game = (stock: { colony2: number; colony3: number }): GameSaveV1 => {
  const record = { crew: 1, landed: {}, troops: [] };
  const names = { difficulty: "easy" as const, name: "Rock", ore: "coal" as const, seed: 9, voyageSeconds: 1 };
  let group = emptyArchipelago();
  for (const id of [1, 2, 3]) group = addColonyRecord(group, id, { ...names, id }, record);
  const colonies = group.colonies.map(colony => colony.expeditionId === 1 ? colony
    : { ...colony, save: island(colony.expeditionId === 2 ? stock.colony2 : stock.colony3) });
  return { ...island(1), archipelago: { ...group, active: 1, colonies, home: island(5) } };
};

/** Bases kept in memory; counts how often an island is compacted (a `find` per compaction). */
const memoryBases = () => {
  const keys = new Map<string, MapBase>(), hashes = new Map<string, string>();
  const counts = { finds: 0 };
  const bases: MapBases = { find: async key => { counts.finds++; return keys.get(key) ?? null; },
    read: async hash => hashes.get(hash) ?? null,
    write: async (key, base) => { keys.set(key, base); hashes.set(base.hash, base.map); } };
  return { bases, counts };
};

const parse = async (body: ArrayBuffer) =>
  JSON.parse(gunzipSync(Buffer.from(body)).toString("utf8")) as Body;
const rowSignatures = (...entries: [IslandKey, string][]) => new Map(entries);
const filed = (colony2: string, colony3: string) =>
  rowSignatures(["home", "home-row"], ["colony-2", colony2], ["colony-3", colony3]);

describe("cloud snapshot body with unchanged-island references (S07)", () => {
  it("sends every island complete until the server's signatures are known, then only what changed", async () => {
    const { bases, counts } = memoryBases(), builder = createSnapshotBodyBuilder();
    const first = await builder.build({ bases, game: game({ colony2: 7, colony3: 9 }), rowSignatures: filed("a", "b") });
    const firstBody = await parse(first.body);
    expect(firstBody.islands.map(entry => entry.key).sort()).toEqual(["colony-1", "colony-2", "colony-3", "home"]);
    expect(firstBody.islands.every(entry => entry.save && !entry.unchanged)).toBe(true);
    const compactedFirst = counts.finds;

    // The server answered with the signatures it stored. Nothing changed but the live island's tick state.
    const second = await builder.build({ bases, game: { ...game({ colony2: 7, colony3: 9 }), savedAt: 11 },
      rowSignatures: filed("a", "b"), serverSignatures: first.signatures });
    const secondBody = await parse(second.body);
    const byKey = new Map(secondBody.islands.map(entry => [entry.key, entry]));
    expect(byKey.get("home")!.unchanged).toBe(first.signatures.home);
    expect(byKey.get("colony-2")!.unchanged).toBe(first.signatures["colony-2"]);
    expect(byKey.get("colony-3")!.unchanged).toBe(first.signatures["colony-3"]);
    expect(byKey.get("colony-1")!.save).toBeDefined();
    expect(counts.finds - compactedFirst).toBe(1);
    expect(second.signatures["colony-1"]).not.toBe(first.signatures["colony-1"]);
    expect({ ...second.signatures, "colony-1": "" }).toEqual({ ...first.signatures, "colony-1": "" });
  });

  it("re-uploads only the colony a shipment changed; untouched islands stay references", async () => {
    const { bases, counts } = memoryBases(), builder = createSnapshotBodyBuilder();
    const first = await builder.build({ bases, game: game({ colony2: 7, colony3: 9 }), rowSignatures: filed("a", "b") });
    const compacted = counts.finds;
    // A ship delivered goods to colony 2: its saved row (and so its row signature) changed.
    const shipped = await builder.build({ bases, game: game({ colony2: 19, colony3: 9 }),
      rowSignatures: filed("a2", "b"), serverSignatures: first.signatures });
    const body = await parse(shipped.body);
    const byKey = new Map(body.islands.map(entry => [entry.key, entry]));
    expect(byKey.get("colony-2")!.save!.data.settlement.buildings[0]!.inventory.logs).toBe(19);
    expect(byKey.get("colony-2")!.unchanged).toBeUndefined();
    expect(byKey.get("colony-3")!.unchanged).toBe(first.signatures["colony-3"]);
    expect(byKey.get("home")!.unchanged).toBe(first.signatures.home);
    expect(shipped.signatures["colony-2"]).not.toBe(first.signatures["colony-2"]);
    expect(counts.finds - compacted).toBe(2);
  });

  it("re-encodes an island whose trade lists changed even when its row signature did not", async () => {
    const { bases } = memoryBases(), builder = createSnapshotBodyBuilder();
    const first = await builder.build({ bases, game: game({ colony2: 7, colony3: 9 }), rowSignatures: filed("a", "b") });
    const withTrade = game({ colony2: 7, colony3: 9 });
    const colony = withTrade.archipelago!.colonies.find(entry => entry.expeditionId === 3)!;
    colony.save = { ...colony.save!, settlement: { ...colony.save!.settlement, trade: { history: [], offers: [] } } as never };
    const changed = await builder.build({ bases, game: withTrade, rowSignatures: filed("a", "b"),
      serverSignatures: first.signatures });
    expect(changed.signatures["colony-3"]).not.toBe(first.signatures["colony-3"]);
    expect(changed.signatures["colony-2"]).toBe(first.signatures["colony-2"]);
  });

  it("compacts every island again without row signatures but still references equal content", async () => {
    const { bases, counts } = memoryBases(), builder = createSnapshotBodyBuilder();
    const first = await builder.build({ bases, game: game({ colony2: 7, colony3: 9 }) });
    const compacted = counts.finds;
    const second = await builder.build({ bases, game: game({ colony2: 7, colony3: 9 }),
      serverSignatures: first.signatures });
    expect(counts.finds - compacted).toBe(4);
    expect((await parse(second.body)).islands.filter(entry => entry.unchanged).length).toBe(4);
  });

  it("sends the islands the server asked for complete, with the bases they need", async () => {
    const { bases } = memoryBases(), builder = createSnapshotBodyBuilder();
    const first = await builder.build({ bases, game: game({ colony2: 7, colony3: 9 }), rowSignatures: filed("a", "b") });
    const slim = await builder.build({ bases, game: game({ colony2: 7, colony3: 9 }), rowSignatures: filed("a", "b"),
      serverSignatures: first.signatures });
    expect((await parse(slim.body)).mapBases).toEqual([]);
    const repaired = await builder.complete(["colony-3"]);
    const body = await parse(repaired.body);
    const byKey = new Map(body.islands.map(entry => [entry.key, entry]));
    expect(byKey.get("colony-3")!.save).toBeDefined();
    expect(byKey.get("colony-2")!.unchanged).toBeDefined();
    expect(body.mapBases!.length).toBe(1);
    expect(body.mapBases![0]!.map).toBe(gameMap());
    expect(repaired.signatures).toEqual(slim.signatures);
  });

  it("does not upload bases the server confirmed", async () => {
    const { bases } = memoryBases(), builder = createSnapshotBodyBuilder();
    const first = await builder.build({ bases, game: game({ colony2: 7, colony3: 9 }) });
    const hash = (await parse(first.body)).mapBases![0]!.hash;
    const again = await builder.build({ bases, confirmed: [hash], game: game({ colony2: 7, colony3: 9 }) });
    expect((await parse(again.body)).mapBases).toEqual([]);
  });
});
