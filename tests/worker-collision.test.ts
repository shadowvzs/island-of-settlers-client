import { describe, expect, it } from "vitest";

import {
  addBody,
  applySeparation,
  BODY,
  type BodyKind,
  clearCrowd,
  computeSeparation,
  createCrowdSpace,
  type CrowdSpace,
  findFreeSpot,
  isSpotTaken
} from "../src/render-common/crowd/crowd-space";
import { WORKER_COLLISION_RADIUS } from "../src/render-common/workers/worker-dimensions";

const STEP = 1 / 120;
const anywhere = () => true;

interface TestBody {
  dirX?: number;
  dirZ?: number;
  kind: BodyKind;
  x: number;
  z: number;
}

/** One fixed step: rebuild the grid from the bodies, separate, write the positions back. */
const stepCrowd = (
  space: CrowdSpace,
  bodies: TestBody[],
  canMove: (fromX: number, fromZ: number, toX: number, toZ: number) => boolean = anywhere
) => {
  clearCrowd(space);
  for (const body of bodies)
    addBody(space, body.x, body.z, WORKER_COLLISION_RADIUS, body.kind, body.dirX, body.dirZ);
  computeSeparation(space, STEP);
  applySeparation(space, canMove);
  bodies.forEach((body, index) => {
    body.x = space.x[index]!;
    body.z = space.z[index]!;
  });
};

const gap = (a: TestBody, b: TestBody) => Math.hypot(a.x - b.x, a.z - b.z);

describe("worker separation", () => {
  it("pushes two idle workers apart gently and then holds still (no oscillation)", () => {
    const space = createCrowdSpace(4);
    const bodies: TestBody[] = [
      { kind: BODY.idle, x: 10, z: 10 },
      { kind: BODY.idle, x: 10.1, z: 10 }
    ];
    let previous = gap(bodies[0]!, bodies[1]!);
    for (let step = 0; step < 240; step++) {
      stepCrowd(space, bodies);
      const current = gap(bodies[0]!, bodies[1]!);
      expect(current).toBeGreaterThanOrEqual(previous - 1e-6);
      expect(current - previous).toBeLessThan(0.017);
      previous = current;
    }
    expect(previous).toBeGreaterThan(WORKER_COLLISION_RADIUS * 2 - 0.01);
    const settled = { ...bodies[0]! };
    for (let step = 0; step < 60; step++) stepCrowd(space, bodies);
    expect(Math.abs(bodies[0]!.x - settled.x)).toBeLessThan(1e-3);
  });

  it("lets a walker yield: the standing worker is not pushed", () => {
    const space = createCrowdSpace(4);
    const bodies: TestBody[] = [
      { kind: BODY.idle, x: 10, z: 10 },
      { dirX: -1, dirZ: 0, kind: BODY.moving, x: 10.23, z: 10 }
    ];
    for (let step = 0; step < 30; step++) stepCrowd(space, bodies);
    expect(bodies[0]).toMatchObject({ x: 10, z: 10 });
    expect(gap(bodies[0]!, bodies[1]!)).toBeGreaterThan(WORKER_COLLISION_RADIUS * 2 - 0.01);
  });

  it("never pushes a worker onto blocked ground", () => {
    const space = createCrowdSpace(4);
    const eastOfWall = (_fromX: number, _fromZ: number, toX: number) => toX >= 10;
    const bodies: TestBody[] = [
      { kind: BODY.idle, x: 10, z: 10 },
      { kind: BODY.idle, x: 10.05, z: 10 }
    ];
    for (let step = 0; step < 400; step++) {
      stepCrowd(space, bodies, eastOfWall);
      expect(bodies.every(({ x }) => x >= 10)).toBe(true);
    }
    expect(gap(bodies[0]!, bodies[1]!)).toBeGreaterThan(WORKER_COLLISION_RADIUS * 2 - 0.01);
  });

  it("sidesteps head-on walkers past each other without overlapping", () => {
    const space = createCrowdSpace(4);
    const bodies: TestBody[] = [
      { dirX: 1, dirZ: 0, kind: BODY.moving, x: 8, z: 10 },
      { dirX: -1, dirZ: 0, kind: BODY.moving, x: 12, z: 10 }
    ];
    let closest = Infinity;
    for (let step = 0; step < 480; step++) {
      for (const body of bodies) body.x += body.dirX! * 0.6 * STEP;
      stepCrowd(space, bodies);
      closest = Math.min(closest, gap(bodies[0]!, bodies[1]!));
    }
    expect(bodies[0]!.x).toBeGreaterThan(bodies[1]!.x);
    expect(closest).toBeGreaterThan(WORKER_COLLISION_RADIUS * 2 - 0.03);
  });

  it("spreads a dense crowd of idle workers until nobody overlaps", () => {
    const space = createCrowdSpace(100);
    const bodies: TestBody[] = Array.from({ length: 100 }, (_, index) => ({
      kind: BODY.idle,
      x: 20 + (index % 10) * 0.2 + ((index * 7) % 5) * 0.01,
      z: 20 + Math.floor(index / 10) * 0.2
    }));
    for (let step = 0; step < 1200; step++) stepCrowd(space, bodies);
    let closest = Infinity;
    bodies.forEach((a, index) =>
      bodies.slice(index + 1).forEach((b) => (closest = Math.min(closest, gap(a, b))))
    );
    expect(closest).toBeGreaterThan(WORKER_COLLISION_RADIUS * 2 - 0.03);
  });
});

describe("arrival on a taken spot", () => {
  const space = createCrowdSpace(4);
  clearCrowd(space);
  addBody(space, 10, 10, WORKER_COLLISION_RADIUS, BODY.idle);
  addBody(space, 12, 10, WORKER_COLLISION_RADIUS, BODY.moving, 1, 0);

  it("sees standing workers, not walking ones, as taking a spot", () => {
    expect(isSpotTaken(space, 10.1, 10, WORKER_COLLISION_RADIUS, 1)).toBe(true);
    expect(isSpotTaken(space, 12, 10, WORKER_COLLISION_RADIUS, 0)).toBe(false);
    expect(isSpotTaken(space, 10, 10, WORKER_COLLISION_RADIUS, 0)).toBe(false);
  });

  it("finds the nearest free spot on free ground", () => {
    const northOnly = (_x: number, z: number) => z > 10.1;
    const spot = findFreeSpot(space, 10, 10, WORKER_COLLISION_RADIUS, 1, northOnly)!;
    expect(spot.z).toBeGreaterThan(10.1);
    expect(Math.hypot(spot.x - 10, spot.z - 10)).toBeGreaterThanOrEqual(WORKER_COLLISION_RADIUS * 2 - 1e-6);
    expect(Math.hypot(spot.x - 10, spot.z - 10)).toBeLessThan(0.9);
    expect(findFreeSpot(space, 10, 10, WORKER_COLLISION_RADIUS, 1, () => false)).toBeNull();
  });
});
