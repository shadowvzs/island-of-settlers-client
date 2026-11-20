import { describe, expect, it } from "vitest";

import { type KeyedStatus, toKeyedStatus } from "../src/app/components/helpers";

describe("keyed status line", () => {
  it("keeps the text while its key holds", () => {
    const entry: KeyedStatus = { key: "1:0", text: "Bought." };
    expect(toKeyedStatus(entry, "1:0")).toBe(entry);
  });

  it("does not bring back a gem shop status after switching category and back", () => {
    // `${opened}:${categoryIndex}`: a purchase on category 0, then category 1, then category 0 again.
    let entry: KeyedStatus = { key: "1:0", text: "Bought." };
    entry = toKeyedStatus(entry, "1:1");
    expect(entry).toEqual({ key: "1:1", text: "" });
    entry = toKeyedStatus(entry, "1:0");
    expect(entry).toEqual({ key: "1:0", text: "" });
  });
});
