import { describe, expect, it } from "vitest";

import {
  islandSignature, islandSignatureKey, keptIslands, staleIslandIds
} from "../src/app/settlement/game-island-rows";

describe("dirty island rows", () => {
  it("signs the same document identically and a changed one differently", async () => {
    const save = { map: "AAAA", settlement: { tick: 5 } };
    expect(await islandSignature(save)).toBe(await islandSignature(structuredClone(save)));
    expect(await islandSignature(save)).not.toBe(await islandSignature({ ...save, settlement: { tick: 6 } }));
    expect(await islandSignature(save)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps only the islands whose signature is stored", () => {
    const signed = [{ id: "home", signature: "a" }, { id: "colony-1", signature: "b" }] as const;
    expect([...keptIslands(signed, new Set(["colony-1"]))]).toEqual([["colony-1", "b"]]);
    expect(keptIslands(signed, new Set()).size).toBe(0);
  });

  it("deletes the stored rows the new game no longer has", () => {
    expect(staleIslandIds(["home", "colony-1", "colony-2"], ["home", "colony-2"])).toEqual(["colony-1"]);
  });

  it("looks a row up by slot, island and signature", () => {
    expect(islandSignatureKey("guest", "colony-3", "abc")).toEqual(["guest", "colony-3", "abc"]);
  });
});
