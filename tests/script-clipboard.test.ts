import { describe, expect, it } from "vitest";

import { walkScriptRefs } from "../../island-of-settlers-shared/src/script/references";
import type { ScriptTrigger } from "../../island-of-settlers-shared/src/script/types/triggers";
import { copyTrigger, pasteTrigger } from "../src/app/map-editor/script/clipboard";
import { createEmptyMapScript } from "../src/app/map-editor/script/script-document";

const trigger = (id: string, reference: string): ScriptTrigger => ({
  actions: [{ args: { trigger: { id: reference, k: "ref", kind: "trigger" } }, id: "s1", k: "do",
    op: "enableTrigger" }],
  conditions: { k: "all", of: [] }, concurrency: "queue", enabled: true, events: [], folderId: null, id,
  name: `Trigger ${id}`, runLimit: null
});

const refs = (value: unknown) => {
  const found: string[] = [];
  walkScriptRefs(value, "", ref => found.push(ref.id));
  return found;
};

describe("script clipboard id remapping (TRG14)", () => {
  it("moves a pasted trigger's self-reference to its new id", () => {
    const source = trigger("trigger-1", "trigger-1"), script = createEmptyMapScript();
    script.triggers.push(source);
    copyTrigger(source);
    const pasted = pasteTrigger(script, null, name => `${name} (copy)`)!;
    expect(pasted.trigger.id).toBe("trigger-2");
    expect(pasted.trigger.name).toBe("Trigger trigger-1 (copy)");
    expect(refs(pasted.trigger)).toEqual(["trigger-2"]);
    expect(refs(source)).toEqual(["trigger-1"]);
  });

  it("keeps references to another trigger unchanged", () => {
    const source = trigger("trigger-1", "trigger-9"), script = createEmptyMapScript();
    copyTrigger(source);
    const pasted = pasteTrigger(script, null, name => name)!;
    expect(refs(pasted.trigger)).toEqual(["trigger-9"]);
  });
});
