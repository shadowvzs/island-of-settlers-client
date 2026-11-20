import { afterEach, expect, it } from "vitest";

import {
  clearNavigationProfile, countNavigation, navigationProfileEnabled, profileNavigationStage,
  readNavigationProfile
} from "../src/shared/settlement/navigation-profile";

const flag = globalThis as { __navigationProfile?: boolean };

afterEach(() => {
  delete flag.__navigationProfile;
  clearNavigationProfile();
});

it("records navigation stages and counters only when opted in", () => {
  expect(navigationProfileEnabled()).toBe(false);
  expect(profileNavigationStage("search", () => 4)).toBe(4);
  countNavigation("visits", 3);
  expect(readNavigationProfile()).toEqual({ counters: {}, stages: {} });

  flag.__navigationProfile = true;
  expect(profileNavigationStage("search", () => 4)).toBe(4);
  countNavigation("visits", 3);
  countNavigation("visits", 2);
  const profile = readNavigationProfile();
  expect(profile.counters).toEqual({ visits: 5 });
  expect(profile.stages.search).toMatchObject({ count: 1, maxMs: expect.any(Number) });
  expect(profile.stages.search!.samples).toHaveLength(1);
  expect(profile.stages.search!.totalMs).toBeCloseTo(profile.stages.search!.samples[0]!);
});

it("keeps the profile bounded and survives a throwing stage", () => {
  flag.__navigationProfile = true;
  expect(() => profileNavigationStage("throwing", () => { throw new Error("stop"); })).toThrow("stop");
  expect(readNavigationProfile().stages.throwing?.count).toBe(1);
});
