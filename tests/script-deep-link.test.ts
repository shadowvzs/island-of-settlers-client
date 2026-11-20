import { describe, expect, it } from "vitest";

import { huntCounter } from "../../island-of-settlers-shared/tests/script-fixtures";
import { scriptIssueLink } from "../src/app/map-editor/campaign/check/path-labels";
import { campaignMapEditorUrl } from "../src/app/map-editor/campaign/helpers";
import { triggerBlocks } from "../src/app/map-editor/script/blocks";
import { linkedFieldPath, readScriptDeepLink, withScriptDeepLink } from "../src/app/map-editor/script/deep-link";
import { showEventRow, showRows } from "../src/app/map-editor/script/form-rows";
import { setAtPath } from "../src/app/map-editor/script/paths";
import { createScriptWorkspace } from "../src/app/map-editor/script/script-workspace";
import type { WorldData } from "../src/shared/world/world-data";

describe("Script window deep link", () => {
  it("reads the tab, item and field path of a page query", () => {
    expect(readScriptDeepLink("?script=triggers&scriptItem=trigger-3&scriptPath=conditions.of%5B0%5D.a")).toEqual({
      itemId: "trigger-3", path: "conditions.of[0].a", tab: "triggers"
    });
    expect(readScriptDeepLink("?script=variables")).toEqual({ tab: "variables" });
    expect(readScriptDeepLink("?scriptItem=trigger-3")).toBeNull();
    expect(readScriptDeepLink("?script=nonsense&scriptItem=trigger-3")).toBeNull();
    expect(readScriptDeepLink("")).toBeNull();
  });

  it("writes a link that reads back unchanged and keeps the other parameters", () => {
    const link = { itemId: "quest-intro", path: "title", tab: "quests" } as const;
    const url = withScriptDeepLink("https://game.test/editor.html?quality=minimal", link);
    expect(new URL(url).searchParams.get("quality")).toBe("minimal");
    expect(readScriptDeepLink(new URL(url).search)).toEqual(link);
  });

  it("links a script issue path to its owner's tab, id and inner path", () => {
    const names = {
      actor: ["Scout"], homeReward: ["Gift"], quest: ["intro"], trigger: ["Intro", "Wolves"], variable: ["kills"],
      ids: {
        actor: ["actor-1"], homeReward: ["reward-1"], quest: ["intro"], trigger: ["trigger-1", "trigger-7"],
        variable: ["variable-2"]
      }
    };
    expect(scriptIssueLink("triggers[1].conditions.of[0].a.variable", names)).toEqual({
      itemId: "trigger-7", path: "conditions.of[0].a.variable", tab: "triggers"
    });
    expect(scriptIssueLink("quests.quests[0].title", names)).toEqual({ itemId: "intro", path: "title", tab: "quests" });
    expect(scriptIssueLink("variables[0]", names)).toEqual({ itemId: "variable-2", tab: "variables" });
    expect(scriptIssueLink("actors[0].family", names)).toEqual({ itemId: "actor-1", path: "family", tab: "actors" });
    expect(scriptIssueLink("homeRewards[0].rewards[1].item", names))
      .toEqual({ itemId: "reward-1", path: "rewards[1].item", tab: "quests" });
    expect(scriptIssueLink("triggers[3].events[0]", undefined)).toEqual({ path: "events[0]", tab: "triggers" });
    expect(scriptIssueLink("regions[0].name", names)).toBeNull();
  });

  it("the campaign map editor URL carries the link next to the slot", () => {
    const plain = new URL(campaignMapEditorUrl("https://game.test/editor.html?mode=campaign", "c1", "m1"));
    expect([...plain.searchParams.keys()]).toEqual(["campaignSlot"]);
    const linked = new URL(campaignMapEditorUrl("https://game.test/editor.html?mode=campaign", "c1", "m1",
      { itemId: "trigger-7", tab: "triggers" }));
    expect(linked.searchParams.get("campaignSlot")).toBe(plain.searchParams.get("campaignSlot"));
    expect(readScriptDeepLink(linked.search)).toEqual({ itemId: "trigger-7", tab: "triggers" });
  });

  it("names the linked field only for the link's own tab and item", () => {
    const link = { itemId: "trigger-1", path: "events[0].slots.killer", tab: "triggers" } as const;
    expect(linkedFieldPath(link, "triggers", "trigger-1")).toEqual(["events", 0, "slots", "killer"]);
    expect(linkedFieldPath(link, "triggers", "trigger-2")).toBeNull();
    expect(linkedFieldPath(link, "quests", "trigger-1")).toBeNull();
    expect(linkedFieldPath({ itemId: "trigger-1", tab: "triggers" }, "triggers", "trigger-1")).toBeNull();
    expect(linkedFieldPath(null, "triggers", "trigger-1")).toBeNull();
  });

  it("marks the row and the slot the link's field path names, and nothing else", () => {
    const script = huntCounter();
    const blocks = triggerBlocks(script.triggers[0]!, { locale: "en", script });
    const linked = ["events", 0, "slots", "killer"];
    const event = showEventRow(blocks.events[0]!, [], linked);
    expect(event.linked).toBe(true);
    const slots = event.parts.filter(part => part.kind === "slot");
    expect(slots.filter(part => part.linked).map(part => part.part.path)).toEqual([linked]);
    const actions = showRows(blocks.actions, [], linked);
    expect(actions.every(row => !("block" in row) || !row.block.linked)).toBe(true);
    const step = showRows(blocks.actions, [], ["actions", 0, "args", "amount"])[0]!;
    expect("block" in step && step.block.linked).toBe(true);
    expect(showEventRow(blocks.events[0]!, []).linked).toBe(false);
  });

  it("an edit ends the field highlight but keeps the selected item", () => {
    const world = { cellsX: 64, cellsZ: 64, scenario: undefined, script: huntCounter() } as unknown as WorldData;
    const workspace = createScriptWorkspace({ onEdit: () => true, store: { clearTool: () => undefined,
      getState: () => ({ tool: null }), selectTool: () => undefined, setHint: () => undefined,
      subscribe: () => () => undefined } as never, world });
    workspace.focusItem({ itemId: "trigger-1", path: "actions[0].args.amount", tab: "triggers" });
    expect(workspace.getSnapshot().focus?.path).toBe("actions[0].args.amount");
    workspace.commit(setAtPath(workspace.getSnapshot().script, ["triggers", 0, "name"], "Renamed"));
    expect(workspace.getSnapshot().focus).toEqual({ itemId: "trigger-1", revision: 1, tab: "triggers" });
    expect(workspace.getSnapshot().selectedTriggerId).toBe("trigger-1");
  });

  it("test play is refused with a notice while the script has errors, and starts once it is Ready", () => {
    const world = { cellsX: 64, cellsZ: 64, scenario: undefined, script: huntCounter() } as unknown as WorldData;
    let started = 0;
    const workspace = createScriptWorkspace({ onEdit: () => true, onTestPlay: () => { started += 1; },
      store: { clearTool: () => undefined, getState: () => ({ tool: null }), selectTool: () => undefined,
        setHint: () => undefined, subscribe: () => () => undefined } as never, world });
    expect(workspace.canTestPlay).toBe(true);
    workspace.testPlay();
    expect(started).toBe(1);
    workspace.commit(setAtPath(workspace.getSnapshot().script, ["triggers", 0, "actions", 0, "args", "amount"], null));
    workspace.testPlay();
    expect(started).toBe(1);
    expect(workspace.getSnapshot().noticeIsRefusal).toBe(true);
  });
});
