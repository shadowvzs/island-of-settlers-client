import { describe, expect, it } from "vitest";

import type { CapturedGame } from "../src/app/save-store/captured-game";
import { createCommandLogSession } from "../src/app/settlement/command-log-session";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const createWorld = () => {
  const size = 48;
  return { seed: 3, cellsX: size, cellsZ: size, seaLevel: -1, start: { x: 8, z: 8 },
    heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array() }
  } as unknown as WorldData;
};

const fixture = () => {
  const world = createWorld(), roads = createRoadNetwork(world, { isBlocked: () => false });
  const simulation = createSettlementSimulation({ clockStart: 0, initialSettlers: 20, initialStock: {},
    resourceTargets: () => [], roads, world });
  const jobs: (() => void)[] = [];
  const session = createCommandLogSession({ bugReplay: { recording: () => false } as never, simulation },
    { queue: job => jobs.push(job) });
  const capture = () => session.capture({ save: [world, simulation.saveState()] } as unknown as CapturedGame).commandLog;
  return { capture, jobs, session, simulation };
};

describe("command log session around save captures", () => {
  it("closes the interval at the capture and opens the next one at the snapshot reload", () => {
    const { capture, jobs, session, simulation } = fixture();
    simulation.update(0.05);
    expect(capture()).toMatchObject({ baseTick: 0, endTick: 1, island: "home" });
    expect(session.capture({ save: [{}, simulation.saveState()] } as unknown as CapturedGame).commandLogTrail)
      .toEqual(simulation.randomAudit().draws());
    expect(capture()).toBeNull();
    jobs.shift()!();
    simulation.update(0.05);
    expect(capture()).toMatchObject({ baseTick: 1, endTick: 2 });
  });

  it("keeps a command issued between the capture and the reload instead of reloading over it", () => {
    const { capture, jobs, simulation } = fixture();
    capture();
    simulation.grantCoins(5);
    jobs.shift()!();
    expect(simulation.headquarters.inventory.coins).toBe(5);
    expect(capture()!.gaps).toEqual([expect.stringContaining("without its snapshot reload")]);
  });

  it("rebases the open interval after a server stock move, marking dropped commands", () => {
    const { capture, jobs, session, simulation } = fixture();
    capture();
    jobs.shift()!();
    session.rebase("home");
    expect(capture()!.gaps).toBeUndefined();
    jobs.shift()!();
    simulation.grantCoins(5);
    session.rebase("home");
    expect(capture()!.gaps).toEqual([expect.stringContaining("server moved island goods")]);
  });

  it("disposes the departing recorder and a queued snapshot reload cannot reopen it", () => {
    const { capture, jobs, session, simulation } = fixture();
    capture();
    session.dispose();
    jobs.shift()!();
    session.dispose();
    simulation.update(0.05);
    expect(session.capture({ save: [{}, simulation.saveState()] } as unknown as CapturedGame).commandLog)
      .toBeNull();
    session.rebase("home");
  });

  it("keeps an accepted server state and its new command interval when an old capture reload finally runs", () => {
    const { capture, jobs, session, simulation } = fixture();
    capture();
    simulation.grantCoins(7);
    const authoritative = simulation.saveState();
    expect(simulation.loadState(authoritative).ok).toBe(true);
    session.rebase("home");
    simulation.grantCoins(3);
    jobs.shift()!();
    expect(simulation.headquarters.inventory.coins).toBe(10);
    expect(capture()!.entries.map(entry => entry.command.name)).toEqual(["grantCoins"]);
  });

  it("never restores a queued old snapshot after its session has been disposed", () => {
    const { capture, jobs, session, simulation } = fixture();
    capture(); session.dispose();
    simulation.grantCoins(5);
    jobs.shift()!();
    expect(simulation.headquarters.inventory.coins).toBe(5);
  });
});
