import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { type MapBase, type MapBases, mapHash } from "../../island-of-settlers-shared/src/save-map-delta";
import { encodeSnapshotBody } from "../src/app/save-store/captured-game";
import { createGameSave, type GameSaveV1 } from "../src/shared/settlement/game-save";
import { packSparseCells } from "../src/shared/settlement/save-cell-codecs";
import type { SettlementSaveV1 } from "../src/shared/settlement/settlement-save-state";
import { createSyntheticDenseWorld } from "./helpers/synthetic-dense-world";

interface UploadBody { mapBases: { catalogue?: true; hash: string; key: string; map?: string }[] }

const createGame = async (provenanceOf: (hash: string) => string | undefined) => {
  const world = createSyntheticDenseWorld({ cells: 64, seed: 5, treeSpacing: 2 });
  const settlement = { format: "island-settlers-settlement", version: 4,
    occupied: packSparseCells(new Uint8Array(64 * 64)), world: { cellsX: 64, cellsZ: 64, seed: 5 } } as unknown as SettlementSaveV1;
  const game = await createGameSave(world, settlement, { animals: [], name: "c", savedAt: 1, source: "t" });
  const hash = await mapHash(game.map);
  const provenance = provenanceOf(hash);
  return { game: (provenance ? { ...game, mapProvenance: { hash: provenance } } : game) as GameSaveV1, hash };
};

/** A slot store that already holds `base` under every key (what the browser database does after the first save). */
const storeWith = (base: MapBase): MapBases => ({
  find: async () => base, read: async () => base.map, write: async () => undefined
});

const upload = async (game: GameSaveV1, bases: MapBases) =>
  JSON.parse(gunzipSync(Buffer.from(await encodeSnapshotBody(game, undefined, bases, []))).toString("utf8")) as UploadBody;

describe("catalogue map bases in an upload (S08)", () => {
  it("references a base that is the published catalogue revision by its hash only", async () => {
    const { game, hash } = await createGame(hashOf => hashOf);
    const body = await upload(game, storeWith({ hash, map: game.map }));
    expect(body.mapBases).toEqual([{ catalogue: true, hash, key: "home:5:64:64" }]);
    expect(JSON.stringify(body).length).toBeLessThan(game.map.length / 2);
  });

  it("uploads the bytes of a base that is not a published revision", async () => {
    const { game, hash } = await createGame(() => undefined);
    const body = await upload(game, storeWith({ hash, map: game.map }));
    expect(body.mapBases).toEqual([{ hash, key: "home:5:64:64", map: game.map }]);
  });

  it("uploads the bytes when the provenance names another revision", async () => {
    const { game, hash } = await createGame(() => "f".repeat(64));
    const body = await upload(game, storeWith({ hash, map: game.map }));
    expect(body.mapBases[0]!.map).toBe(game.map);
  });

  it("sends nothing for a base the server confirmed", async () => {
    const { game, hash } = await createGame(hashOf => hashOf);
    const confirmed = JSON.parse(gunzipSync(Buffer.from(
      await encodeSnapshotBody(game, undefined, storeWith({ hash, map: game.map }), [hash]))).toString("utf8")) as UploadBody;
    expect(confirmed.mapBases).toEqual([]);
  });
});
