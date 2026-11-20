import { describe, expect, it } from "vitest";

import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import {
  auditRandom, createRandomAudit, firstDifferentDraw, RANDOM_AUDIT_SIZE
} from "../src/shared/settlement/simulation-random";
import { createStatefulRandom } from "../src/shared/world/rng";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const createWorld = () => {
  const size = 48;
  return { seed: 3, cellsX: size, cellsZ: size, seaLevel: -1, start: { x: 8, z: 8 },
    heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array() }
  } as unknown as WorldData;
};

const auditedPair = () => {
  const audit = createRandomAudit(), random = auditRandom("wildlife", createStatefulRandom(7));
  audit.attach([random]);
  return { audit, random };
};

describe("audited simulation random facade", () => {
  it("draws the same numbers as the wrapped stream and tags each draw", () => {
    const { audit, random } = auditedPair(), plain = createStatefulRandom(7);
    audit.setTick(12);
    expect(random.at("wildlife.trot", 4)()).toBe(plain());
    expect(random()).toBe(plain());
    expect(audit.draws()).toEqual([
      { entity: 4, sequence: 0, site: "wildlife.trot", state: expect.any(Number), stream: "wildlife", tick: 12 },
      { entity: 4, sequence: 1, site: "wildlife.trot", state: random.getState(), stream: "wildlife", tick: 12 }
    ]);
    expect(audit.states()).toEqual([["wildlife", plain.getState()]]);
  });

  it("keeps only the last ring of draws and restarts the sequence on a load", () => {
    const { audit, random } = auditedPair();
    for (let index = 0; index < RANDOM_AUDIT_SIZE + 5; index++) random.at("site", index)();
    const draws = audit.draws();
    expect(draws).toHaveLength(RANDOM_AUDIT_SIZE);
    expect(draws[0]!.sequence).toBe(5);
    expect(draws.at(-1)!.entity).toBe(RANDOM_AUDIT_SIZE + 4);
    audit.reset();
    expect(audit.draws()).toEqual([]);
  });

  it("reports the first draw where two trails of one interval differ", () => {
    const run = (sites: string[]) => {
      const { audit, random } = auditedPair();
      for (const site of sites) random.at(site, 1)();
      return audit.draws();
    };
    const expected = run(["a", "b", "c"]);
    expect(firstDifferentDraw(expected, run(["a", "b", "c"]))).toBeNull();
    expect(firstDifferentDraw(expected, run(["a", "x", "c"]))).toMatchObject({ sequence: 1,
      actual: { site: "x" }, expected: { site: "b" } });
    expect(firstDifferentDraw(expected, run(["a", "b"]))).toMatchObject({ sequence: 2, expected: { site: "c" } });
  });

  it("covers the island's own streams and the runtime's streams it is given", () => {
    const world = createWorld(), roads = createRoadNetwork(world, { isBlocked: () => false });
    const wildlife = auditRandom("wildlife", createStatefulRandom(5));
    const simulation = createSettlementSimulation({ initialSettlers: 20, initialStock: {}, randomStreams: [wildlife],
      resourceTargets: () => [], roads, world });
    expect(simulation.randomAudit().states().map(([stream]) => stream)).toEqual(["forester", "military", "wildlife"]);
    simulation.update(0.05);
    wildlife.at("wildlife.test", 2)();
    expect(simulation.randomAudit().draws().at(-1)).toMatchObject({ site: "wildlife.test", tick: 0 });
    simulation.grantDebugTroop();
    expect(simulation.randomAudit().draws().at(-1)).toMatchObject({ site: "debug.troop", stream: "military" });
  });
});
