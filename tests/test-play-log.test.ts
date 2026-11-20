import { describe, expect, it } from "vitest";

import { TEST_PLAY_SLOT } from "../src/app/map-editor/map-storage";
import {
  formatGameTime, isTestPlay, logLineText, testPlayLogRows, testPlayNames, testPlayUrl, toggledKinds
} from "../src/app/script/test-play/helpers";
import { createTestPlayLog } from "../src/app/script/test-play/test-play-log";

const names = testPlayNames({
  triggers: [{ id: "trigger-1", name: "Wolves attack" }], variables: [{ id: "variable-1", name: "kills" }]
} as never);

describe("play-test page", () => {
  it("builds a game URL that reads back as a play-test and drops the editor parameters", () => {
    const url = testPlayUrl("https://game.test/app/editor.html?campaignSlot=c1&script=triggers");
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/app/");
    expect(parsed.searchParams.get("map")).toBe(TEST_PLAY_SLOT);
    expect(parsed.searchParams.get("skipLogin")).toBe("1");
    expect(parsed.searchParams.has("campaignSlot")).toBe(false);
    expect(isTestPlay(parsed.search)).toBe(true);
  });

  it("is a play-test only on the editor's own play-test slot", () => {
    expect(isTestPlay("?testPlay=1&map=map-abc")).toBe(false);
    expect(isTestPlay(`?map=${TEST_PLAY_SLOT}`)).toBe(false);
    expect(isTestPlay("")).toBe(false);
  });
});

describe("play-test log", () => {
  it("prints game time as mm:ss", () => {
    expect(formatGameTime(0)).toBe("00:00");
    expect(formatGameTime(20 * 75 + 19)).toBe("01:15");
  });

  it("names triggers and variables and prints a step by its action or kind", () => {
    expect(logLineText({ event: "mapStarted", kind: "run", owner: { kind: "trigger", triggerId: "trigger-1" },
      runId: 3 }, names)).toBe("#3 trigger \"Wolves attack\" fired by mapStarted");
    expect(logLineText({ kind: "run", owner: { kind: "trigger", triggerId: "trigger-9" }, runId: 4 }, names))
      .toBe("#4 trigger \"trigger-9\" started");
    expect(logLineText({ kind: "run", owner: { kind: "quest", list: "onSuccess", questId: "intro" }, runId: 5 },
      names)).toBe("#5 quest \"intro\" runs onSuccess");
    expect(logLineText({ kind: "step", op: "setVariable", runId: 3, stepId: "s1", stepKind: "do" }, names))
      .toBe("#3 setVariable");
    expect(logLineText({ kind: "step", runId: 3, stepId: "s2", stepKind: "wait" }, names)).toBe("#3 wait");
    expect(logLineText({ from: "active", kind: "quest", questId: "intro", to: "succeeded" }, names))
      .toBe("Quest \"intro\": active → succeeded");
    expect(logLineText({ kind: "variable", value: { type: "number", value: 7 }, variableId: "variable-1" }, names))
      .toBe("kills = 7");
  });

  it("publishes buffered lines in order, keeps the newest and filters hidden kinds", () => {
    const log = createTestPlayLog(3);
    for (let value = 1; value <= 4; value++) {
      log.record({ kind: "variable", value: { type: "number", value }, variableId: "variable-1" }, value * 20);
    }
    expect(log.store.getSnapshot()).toEqual([]);
    log.publish();
    log.record({ from: null, kind: "quest", questId: "intro", to: "active" }, 100);
    log.publish();
    const rows = testPlayLogRows(log.store.getSnapshot(), new Set(), names);
    expect(rows.map(row => `${row.time} ${row.text}`)).toEqual([
      "00:03 kills = 3", "00:04 kills = 4", "00:05 Quest \"intro\": – → active"
    ]);
    const hidden = toggledKinds(new Set(), "variable");
    expect(testPlayLogRows(log.store.getSnapshot(), hidden, names).map(row => row.kind)).toEqual(["quest"]);
    expect(toggledKinds(hidden, "variable").size).toBe(0);
    log.clear();
    expect(log.store.getSnapshot()).toEqual([]);
  });
});
