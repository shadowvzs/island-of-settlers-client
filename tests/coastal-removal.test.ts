import { expect, it } from "vitest";

import {
  createPlayerProgress, migratePlayerProgress, validatePlayerProgress
} from "../src/shared/progression/player-progress";

it("drops the retired weekly coastal offer from player progress", () => {
  const progress = { ...createPlayerProgress(3), coastalWeek: "2026-10-12" };
  const migrated = migratePlayerProgress(progress);
  expect(migrated).not.toHaveProperty("coastalWeek");
  expect(validatePlayerProgress(migrated)).toBe(true);
  expect(migratePlayerProgress(createPlayerProgress(3))).toEqual(createPlayerProgress(3));
});
