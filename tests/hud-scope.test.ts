import { describe, expect, it } from "vitest";

import { createExplorationHudScope } from "../src/app/exploration/ui/hud-scope";
import { createHudScope, type HudScopeRoot } from "../src/app/hud-scope/hud-scope";

const createRoot = (initial: Record<string, string> = {}) => {
  const attributes = new Map(Object.entries(initial));
  const root: HudScopeRoot = {
    getAttribute: name => attributes.get(name) ?? null,
    removeAttribute: name => { attributes.delete(name); },
    setAttribute: (name, value) => { attributes.set(name, value); }
  };
  return { attributes, root };
};

describe("shared HUD scope", () => {
  it("hides and restores one reason idempotently", () => {
    const { attributes, root } = createRoot();
    const scope = createHudScope("cinematic", root);
    scope.set(true);
    scope.set(true);
    expect(attributes.get("data-cinematic")).toBe("on");
    expect(scope.hidden()).toBe(true);
    scope.set(false);
    scope.set(false);
    expect(attributes.has("data-cinematic")).toBe(false);
    expect(scope.restoreCount()).toBe(1);
  });

  it("keeps the two reasons independent in either restore order", () => {
    for (const cinematicFirst of [true, false]) {
      const { attributes, root } = createRoot();
      const exploration = createExplorationHudScope(root);
      const cinematic = createHudScope("cinematic", root);
      exploration.sync("possessed");
      cinematic.set(true);
      expect(attributes.get("data-exploration-hud")).toBe("hidden");
      expect(attributes.get("data-cinematic")).toBe("on");
      if (cinematicFirst) cinematic.set(false);
      else exploration.sync("idle");
      expect(attributes.size).toBe(1);
      if (cinematicFirst) exploration.sync("idle");
      else cinematic.set(false);
      expect(attributes.size).toBe(0);
    }
  });

  it("restores a pre-existing attribute value and ignores calls after dispose", () => {
    const { attributes, root } = createRoot({ "data-cinematic": "preview" });
    const scope = createHudScope("cinematic", root);
    scope.set(true);
    scope.dispose();
    expect(attributes.get("data-cinematic")).toBe("preview");
    scope.set(true);
    expect(attributes.get("data-cinematic")).toBe("preview");
  });
});
