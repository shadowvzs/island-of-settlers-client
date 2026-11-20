import { expect, it, vi } from "vitest";

import { actorActionEnabled, actorActionFlag } from "../src/render-common/workers/actor-action-capabilities";
import config from "../src/render-common/workers/actor-action-capabilities.json";

it("uses only numeric 0/1 configuration for the existing actor identities and denies unknown input", () => {
  expect(Object.keys(config)).toEqual(["Scout", "Soldier", "shield", "heavy", "archer", "cavalry", "commander"]);
  for (const profile of Object.values(config)) for (const flag of Object.values(profile)) expect([0, 1]).toContain(flag);
  expect(actorActionFlag("Scout", "jumping")).toBe(1);
  expect(actorActionFlag("Scout", "possessedJump")).toBe(1);
  for (const actor of Object.keys(config).filter(actor => actor !== "Scout")) {
    expect(actorActionFlag(actor, "jumping")).toBe(0);
    expect(actorActionFlag(actor, "spyglass")).toBe(0);
  }
  for (const actor of [undefined, null, {}, "unknown", "__proto__", "explorer"]) {
    expect(actorActionFlag(actor, "move")).toBe(0);
    expect(actorActionFlag(actor, "jumping")).toBe(0);
    expect(actorActionEnabled(actor, "back")).toBe(true);
  }
  expect(actorActionFlag("Scout", "unimplemented-attack")).toBe(0);
});

it("resolves JSON prerequisites centrally while jump and fullscreen stay independent", async () => {
  vi.resetModules();
  vi.doMock("../src/render-common/workers/actor-action-capabilities.json", () => ({
    default: { ...config, Scout: { ...config.Scout, move: 0, look: 0, spyglass: 0 } }
  }));
  try {
    const changed = await import("../src/render-common/workers/actor-action-capabilities");
    for (const action of ["forward", "backward", "turnLeft", "turnRight", "zoomIn", "zoomOut"])
      expect(changed.actorActionFlag("Scout", action)).toBe(0);
    expect(changed.actorActionFlag("Scout", "jumping")).toBe(1);
    expect(changed.actorActionFlag("Scout", "fullscreen")).toBe(1);
  } finally { vi.doUnmock("../src/render-common/workers/actor-action-capabilities.json"); vi.resetModules(); }
});
