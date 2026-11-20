import { randomUUID } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
// @ts-expect-error pg ships no types for the client package; the API package owns its typings.
import pg from "../../island-of-settlers-api/node_modules/pg";
import { describe, expect, it } from "vitest";

import { createBackendService } from "../../island-of-settlers-shared/server/service";
import type { AccessClaims } from "../../island-of-settlers-shared/src/contracts";
import type { MapBase, MapBases } from "../../island-of-settlers-shared/src/save-map-delta";
import { createSaveRepository } from "../../island-of-settlers-api/src/save-repository";
import { registerSaveRoutes } from "../../island-of-settlers-api/src/save-routes";
import { createSnapshotBodyBuilder } from "../src/app/save-store/snapshot-body";
import { addColonyRecord, emptyArchipelago } from "../src/shared/settlement/archipelago";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import type { IslandKey } from "../src/shared/settlement/game-save-rows";

/**
 * The client's body builder against the real save route and PostgreSQL (TEST_DATABASE_URL): the signature the
 * client computes for an island equals the one the server stores, so references are accepted and a changed
 * colony is the only island that travels again.
 */
const databaseUrl = process.env.TEST_DATABASE_URL;
interface TestPool {
  end(): Promise<void>;
  query<Row>(sql: string, values?: unknown[]): Promise<{ rows: Row[] }>;
}

const gameMap = () => {
  const header = Buffer.from(JSON.stringify({ seed: 1, cellsX: 8, cellsZ: 8,
    chunks: [{ name: "heights", type: "f32", length: 81 }] }));
  const length = Buffer.alloc(4); length.writeUInt32LE(header.length);
  return Buffer.concat([Buffer.from([73, 79, 83, 77, 2, 0, 0, 0]),
    gzipSync(Buffer.concat([length, header, Buffer.alloc(81 * 4)]))]).toString("base64");
};
const island = (logs: number): GameSaveV1 => ({ format: "island-settlers-game", map: gameMap(),
  progress: { fog: { length: 0, packed: "" }, surveyed: [] }, savedAt: 10,
  settlement: { buildings: [{ inventory: { logs }, typeId: 29 }], world: { cellsX: 8, cellsZ: 8, seed: 1 } } as never,
  version: 4 });

const game = (colony2: number): GameSaveV1 => {
  const record = { crew: 1, landed: {}, troops: [] };
  const names = { difficulty: "easy" as const, name: "Rock", ore: "coal" as const, seed: 9, voyageSeconds: 1 };
  let group = emptyArchipelago();
  for (const id of [1, 2, 3]) group = addColonyRecord(group, id, { ...names, id }, record);
  const colonies = group.colonies.map(colony => colony.expeditionId === 1 ? colony
    : { ...colony, save: island(colony.expeditionId === 2 ? colony2 : 9) });
  return { ...island(1), archipelago: { ...group, active: 1, colonies, home: island(5) } };
};

const memoryBases = (): MapBases => {
  const keys = new Map<string, MapBase>(), hashes = new Map<string, string>();
  return { find: async key => keys.get(key) ?? null, read: async hash => hashes.get(hash) ?? null,
    write: async (key, base) => { keys.set(key, base); hashes.set(base.hash, base.map); } };
};
const rows = (...entries: [IslandKey, string][]) => new Map(entries);

describe.skipIf(!databaseUrl)("client signatures against the real save route", () => {
  it("accepts references, and re-uploads only the colony a shipment changed", async () => {
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 3 }) as TestPool;
    const account = randomUUID(), repository = createSaveRepository(pool as never);
    const app = createBackendService({ config: { databaseUrl: "postgresql://unused", host: "127.0.0.1", port: 3002,
      publicUrl: "http://api.test", corsOrigins: [], logLevel: "silent", service: "api" },
    readiness: async () => true, logging: false });
    registerSaveRoutes(app, repository, async () => ({ sub: account }) as AccessClaims);
    const slot = (await repository.create(account, 1, "client signatures")).id;
    const builder = createSnapshotBodyBuilder(), bases = memoryBases();
    let revision = 0, server: Record<string, string> = {};
    const put = async (current: GameSaveV1, signed: ReadonlyMap<IslandKey, string>) => {
      const upload = await builder.build({ bases, game: current, rowSignatures: signed, serverSignatures: server });
      const token = (await repository.issueIntervalToken(account, slot, revision)).token;
      const response = await app.inject({ method: "PUT", url: `/v1/saves/${slot}/snapshot`,
        headers: { "if-match": String(revision), "x-interval-token": token },
        payload: JSON.parse(gunzipSync(Buffer.from(upload.body)).toString("utf8")) });
      return { response, upload };
    };
    const stored = async () => (await pool.query<{ island_key: string; md5: string; signature: string }>(
      "SELECT island_key,md5(compressed_save) AS md5,signature FROM game.islands WHERE slot_id=$1", [slot]))
      .rows.sort((a, b) => a.island_key.localeCompare(b.island_key));
    try {
      const filed = rows(["home", "h"], ["colony-2", "a"], ["colony-3", "b"]);
      const first = await put(game(7), filed);
      expect(first.response.statusCode, first.response.body).toBe(200);
      server = first.response.json().islandSignatures;
      expect(server).toEqual(first.upload.signatures);
      const before = await stored();
      expect(Object.fromEntries(before.map(row => [row.island_key, row.signature]))).toEqual(first.upload.signatures);
      revision = 1;

      const slim = await put(game(7), filed);
      expect(slim.response.statusCode, slim.response.body).toBe(200);
      const idle = await stored();
      for (const key of ["colony-2", "colony-3", "home"])
        expect(idle.find(row => row.island_key === key)!.md5).toBe(before.find(row => row.island_key === key)!.md5);
      server = slim.response.json().islandSignatures;
      revision = 2;

      const shipped = await put(game(19), rows(["home", "h"], ["colony-2", "a2"], ["colony-3", "b"]));
      expect(shipped.response.statusCode, shipped.response.body).toBe(200);
      const after = await stored();
      const md5 = (list: typeof after, key: string) => list.find(row => row.island_key === key)!.md5;
      expect(md5(after, "colony-2")).not.toBe(md5(idle, "colony-2"));
      expect(md5(after, "colony-3")).toBe(md5(idle, "colony-3"));
      expect(md5(after, "home")).toBe(md5(idle, "home"));
      expect(shipped.response.json().islandSignatures["colony-2"]).toBe(shipped.upload.signatures["colony-2"]);
    } finally {
      await pool.query("DELETE FROM game.save_slots WHERE account_id=$1", [account]);
      await app.close();
      await pool.end();
    }
  });
});
