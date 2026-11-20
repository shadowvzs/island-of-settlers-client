import { describe, expect, it } from "vitest";

import type { SettlementSaveV1 } from "../src/shared/settlement/settlement-save-state";
import { hashSettlementState, hashText } from "../src/shared/settlement/settlement-state-hash";
import type { WorldData } from "../src/shared/world/world-data";

const world = () => ({
  fog: new Uint8Array(16), heights: new Float32Array(25), oreAmount: new Uint8Array(16),
  props: { count: 1, phase: new Float32Array(4), types: new Uint8Array(4), x: new Float32Array(4), z: new Float32Array(4) }
}) as unknown as WorldData;
const settlement = { buildings: [{ inventory: { logs: 4 }, uid: 0 }] } as unknown as SettlementSaveV1;

describe("settlement state hash (BACKEND-03)", () => {
  it("is a fixed 64-bit digest of the text, the same on every host", () => {
    expect(hashText("island")).toMatch(/^[0-9a-f]{16}$/);
    expect(hashText("island")).toBe(hashText("island"));
    expect(hashText("island")).not.toBe(hashText("islanc"));
    // Pinned: client and server must agree on the algorithm, so any change is a protocol version.
    expect(hashText("")).toBe("79aea14ecb5dc92f");
  });

  it("changes with any stock, world resource or runtime difference", () => {
    const base = hashSettlementState({ settlement, world: world() });
    expect(hashSettlementState({ settlement: structuredClone(settlement), world: world() })).toBe(base);
    const richer = structuredClone(settlement);
    (richer.buildings[0]!.inventory as Record<string, number>).logs = 5;
    expect(hashSettlementState({ settlement: richer, world: world() })).not.toBe(base);
    const mined = world();
    mined.oreAmount[3] = 1;
    expect(hashSettlementState({ settlement, world: mined })).not.toBe(base);
    expect(hashSettlementState({ runtime: { time: 1 }, settlement, world: world() })).not.toBe(base);
  });

  it("ignores the presentation-only prop sway phase (saves omit it)", () => {
    const swaying = world();
    swaying.props.phase[0] = 2;
    expect(hashSettlementState({ settlement, world: swaying }))
      .toBe(hashSettlementState({ settlement, world: world() }));
  });

  it("hashes object keys in canonical order", () => {
    const reordered = { buildings: [{ uid: 0, inventory: { logs: 4 } }] } as unknown as SettlementSaveV1;
    expect(hashSettlementState({ settlement: reordered, world: world() }))
      .toBe(hashSettlementState({ settlement, world: world() }));
  });

  it("ignores unused prop pool capacity", () => {
    const spare = world();
    spare.props.types[3] = 9;
    expect(hashSettlementState({ settlement, world: spare })).toBe(hashSettlementState({ settlement, world: world() }));
  });
});
