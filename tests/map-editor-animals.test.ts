import { describe, expect, it, vi } from "vitest";

import { RESPAWN_SECONDS } from "../src/render-common/wildlife/population/respawn-ledger";
import {
  createPlacedRespawns,
  isForestHome
} from "../src/render-common/wildlife/sim/animal-placement";
import { PROP, type WorldData } from "../src/shared/world/world-data";

/** A world with only props (what the forest check reads) on a 64² grid. */
const createWorld = (trees: [number, number][]) =>
  ({
    cellsX: 64,
    cellsZ: 64,
    props: {
      count: trees.length,
      types: Uint8Array.from(trees, () => PROP.broadleafTree),
      x: Float32Array.from(trees, ([x]) => x),
      z: Float32Array.from(trees, ([, z]) => z)
    }
  }) as unknown as WorldData;

const GROVE: [number, number][] = [
  [10, 10],
  [11, 12],
  [9, 13],
  [12, 9],
  [13, 11]
];

describe("placed animals respawn only in a forest", () => {
  it("tells a forest home from open ground", () => {
    const world = createWorld(GROVE);
    expect(isForestHome(world, 11, 11)).toBe(true);
    expect(isForestHome(world, 40, 40)).toBe(false);
  });

  it("brings a dead animal back at a forest home, never on open ground", () => {
    const respawns = createPlacedRespawns(createWorld(GROVE));
    const place = vi.fn(() => true);
    respawns.onDeath(1, 11, 11);
    respawns.onDeath(2, 60, 60);
    respawns.update(RESPAWN_SECONDS - 1, place);
    expect(place).not.toHaveBeenCalled();
    respawns.update(2, place);
    expect(place).toHaveBeenCalledOnce();
    expect(place).toHaveBeenCalledWith(1, 11, 11);
    respawns.update(RESPAWN_SECONDS, place);
    expect(place).toHaveBeenCalledOnce();
  });
});
