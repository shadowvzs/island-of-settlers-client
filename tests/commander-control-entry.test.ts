import { expect, it } from "vitest";

import { commanderControlEntryVisible } from "../src/app/commander-control/helpers";

it("shows the commander control entry only outside the lodge", () => {
  expect(commanderControlEntryVisible(undefined)).toBe(false);
  expect(commanderControlEntryVisible({ location: "lodge" })).toBe(false);
  expect(commanderControlEntryVisible({ location: "recovering" })).toBe(false);
  expect(commanderControlEntryVisible({ location: "field" })).toBe(true);
});
