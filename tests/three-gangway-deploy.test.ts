import { BoxGeometry, Mesh, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import {
  advanceGangwayRun, isTroopGangwaySite, startGangwayRun
} from "../src/renderers/three/settlement/three-gangway-deploy";
import { TROOP_GANGWAY_SITE_ID_OFFSET } from "../src/shared/settlement/constants";
import type { ShipWorkpoint } from "../src/shared/settlement/settlement-ship-workpoint";

const WORK = { contact: { x: 10, z: 5 }, point: { x: 8, z: 5 }, shore: { x: 6, z: 5 }, shoreY: 0, y: .2 } as
  unknown as ShipWorkpoint;

/** Where the shore foot of the board is drawn now. */
const drawnFoot = (mesh: Mesh) => new Vector3(6, .2, 5).applyMatrix4(mesh.matrix);

describe("troop gangway run (visual only)", () => {
  it("runs out from the hull contact to the shore and keeps the identity pose once out", () => {
    const mesh = new Mesh(new BoxGeometry());
    const run = startGangwayRun(mesh, WORK, 100);
    expect(advanceGangwayRun(run, 100)).toBe("running");
    expect(drawnFoot(mesh).x).toBeGreaterThan(9.9);
    expect(advanceGangwayRun(run, 100.35)).toBe("running");
    expect(drawnFoot(mesh).x).toBeCloseTo(8, 5);
    expect(drawnFoot(mesh).z).toBeCloseTo(5, 5);
    expect(advanceGangwayRun(run, 101)).toBe("out");
    expect(drawnFoot(mesh).x).toBeCloseTo(6, 5);
  });

  it("runs back in after the ship sails and reports when it is gone", () => {
    const mesh = new Mesh(new BoxGeometry());
    const run = { ...startGangwayRun(mesh, WORK, 0), deployed: undefined, retracted: 50 };
    expect(advanceGangwayRun(run, 50)).toBe("running");
    expect(drawnFoot(mesh).x).toBeCloseTo(6, 5);
    expect(advanceGangwayRun(run, 51)).toBe("in");
  });

  it("only animates troop gangway sites", () => {
    expect(isTroopGangwaySite(TROOP_GANGWAY_SITE_ID_OFFSET + 3)).toBe(true);
    expect(isTroopGangwaySite(1_000_003)).toBe(false);
    expect(isTroopGangwaySite(2_000_003)).toBe(false);
  });
});
