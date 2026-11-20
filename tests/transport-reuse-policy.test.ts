import { expect, it } from "vitest";

import {
  chooseNextTransportJob, chooseTransportForJob, type TransportReuseCandidate
} from "../src/shared/settlement/transport-reuse-policy";

const unit = (id: number, availability: TransportReuseCandidate<number>["availability"],
  atSource: boolean, routeCost = 0): TransportReuseCandidate<number> => ({ atSource, availability, id, routeCost, value: id });

it("reserves the compatible local unloading unit ahead of local idle and remote empty units", () => {
  const candidates = [unit(3, "idle", true), unit(2, "returning", false, 2), unit(0, "unloading", true)];
  expect(chooseTransportForJob(candidates)).toBe(0);
  expect(chooseTransportForJob([...candidates].reverse())).toBe(0);
});

it("uses locality and real pickup cost without making a long detour just to prefer a returning unit", () => {
  expect(chooseTransportForJob([unit(1, "returning", false, 1), unit(2, "idle", true, 0)])).toBe(2);
  expect(chooseTransportForJob([unit(1, "returning", false, 100), unit(2, "idle", false, 2)])).toBe(2);
  expect(chooseTransportForJob([unit(8, "idle", false, 2), unit(9, "returning", false, 2)])).toBe(9);
  expect(chooseTransportForJob([unit(8, "returning", false, 2), unit(0, "returning", false, 2)])).toBe(0);
});

it("rejects remote unloads and unavailable routes without mutating the dispatcher's candidates", () => {
  const candidates = [unit(0, "unloading", false), unit(1, "idle", true, Infinity),
    unit(2, "returning", false, NaN), unit(3, "idle", false, -1)];
  const original = structuredClone(candidates);
  expect(chooseTransportForJob(candidates)).toBeUndefined();
  expect(candidates).toStrictEqual(original);
  expect(chooseTransportForJob([])).toBeUndefined();
});

it("prioritizes the greatest uncovered need over proximity, using distance and age only for ties", () => {
  const near = { order: 0, remainingNeed: 4, routeDistance: 2, value: "near" };
  const far = { order: 1, remainingNeed: 20, routeDistance: 50, value: "far" };
  expect(chooseNextTransportJob([near, far])).toBe("far");
  expect(chooseNextTransportJob([{ ...near, remainingNeed: 20 }, far])).toBe("near");
  const older = { ...far, order: 0, value: "older" };
  expect(chooseNextTransportJob([far, older])).toBe("older");
  expect(chooseNextTransportJob([older, far])).toBe("older");
});

it("does not let covered or unreachable needs outrank an actual uncovered delivery", () => {
  const candidates = [{ order: 0, remainingNeed: 0, routeDistance: 1, value: "already-covered" },
    { order: 1, remainingNeed: 100, routeDistance: Infinity, value: "unreachable" },
    { order: 2, remainingNeed: 2, routeDistance: 50, value: "needed" }];
  const original = structuredClone(candidates);
  expect(chooseNextTransportJob(candidates)).toBe("needed");
  expect(candidates).toStrictEqual(original);
});
