import { expect, it, vi } from "vitest";

import { findWorld } from "../src/shared/settlement/colony-world-choice";
import type { WorldData } from "../src/shared/world/world-data";

/*
 * The fake candidates are not real worlds (the real dry run builds a settlement simulation, which throws on
 * them since the sea-mask capture, 2eb1d9d5c): the dry run is injected and only reads a marker.
 */
/** Fake candidates: the dry run only reads a marker, so no world generation runs here. */
const candidate = (attempt: number, refined: boolean) =>
  ({ attempt, refined, seed: attempt } as unknown as WorldData);
const hosts = (world: WorldData) => (world as unknown as { attempt: number }).attempt === 2;
const hostsRefined = (world: WorldData) => (world as unknown as { refined: boolean }).refined;

it("D-M5: generates cheap candidates, refines only the winner and repeats the dry run once", () => {
  const generate = vi.fn((attempt: number, relief?: { fluvialErosion?: number }) =>
    candidate(attempt, relief?.fluvialErosion !== undefined));
  const world = findWorld(generate, hosts, { fluvialErosion: 1 });
  expect(world).toMatchObject({ attempt: 2, refined: true });
  expect(generate.mock.calls.map(([attempt, relief]) => [attempt, relief?.fluvialErosion]))
    .toEqual([[0, undefined], [1, undefined], [2, undefined], [2, 1]]);
});

it("keeps the plain winner when the refined world fails its dry run, and skips refinement without relief", () => {
  const generate = vi.fn((attempt: number, relief?: { fluvialErosion?: number }) =>
    candidate(attempt, relief?.fluvialErosion !== undefined));
  const failingRefined = findWorld(generate,
    candidateWorld => hosts(candidateWorld) && !hostsRefined(candidateWorld), { fluvialErosion: .8 });
  expect(failingRefined).toMatchObject({ attempt: 2, refined: false });
  expect(generate).toHaveBeenCalledTimes(4);
  generate.mockClear();
  const plain = findWorld(generate, hosts);
  expect(plain).toMatchObject({ attempt: 2, refined: false });
  expect(generate).toHaveBeenCalledTimes(3);
});
