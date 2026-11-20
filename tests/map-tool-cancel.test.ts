import { describe, expect, it, vi } from "vitest";

import { createMapToolCancel } from "../src/app/map-tool-cancel";

const harness = () => {
  const target = new EventTarget();
  const surface = { ownerDocument: { defaultView: target } } as unknown as HTMLElement;
  let active = true;
  const cancel = vi.fn(() => { active = false; });
  const dispose = createMapToolCancel({ active: () => active, cancel, surface });
  const downstream = vi.fn();
  for (const type of ["pointerdown", "pointerup", "contextmenu"])
    target.addEventListener(type, downstream);
  const fire = (type: string, overSurface = true, button = 2) => {
    const event = Object.assign(new Event(type, { cancelable: true }), {
      button, composedPath: () => overSurface ? [surface, target] : [target]
    });
    target.dispatchEvent(event);
    return event;
  };
  return { cancel, dispose, downstream, fire };
};

describe("pending map tool right-click cancellation", () => {
  it.each(["release-first", "context-first"])("consumes the entire %s gesture without a command", order => {
    const f = harness();
    expect(f.fire("pointerdown").defaultPrevented).toBe(true);
    const sequence = order === "release-first" ? ["pointerup", "contextmenu"] : ["contextmenu", "pointerup"];
    for (const type of sequence) expect(f.fire(type).defaultPrevented).toBe(true);
    expect(f.cancel).toHaveBeenCalledOnce();
    expect(f.downstream).not.toHaveBeenCalled();
    // No new pointer gesture precedes a keyboard menu request on a panel or the map.
    expect(f.fire("contextmenu", false, 0).defaultPrevented).toBe(false);
    expect(f.fire("contextmenu", true, 0).defaultPrevented).toBe(false);
    expect(f.downstream).toHaveBeenCalledTimes(2);
    f.dispose();
  });

  it("does not retain a missing release across the next gesture", () => {
    const f = harness();
    expect(f.fire("pointerdown").defaultPrevented).toBe(true);
    expect(f.fire("contextmenu").defaultPrevented).toBe(true);
    f.downstream.mockClear();
    expect(f.fire("contextmenu", false, 0).defaultPrevented).toBe(false);
    expect(f.fire("pointerdown", false, 0).defaultPrevented).toBe(false);
    expect(f.fire("pointerup", false).defaultPrevented).toBe(false);
    expect(f.downstream).toHaveBeenCalledTimes(3);
    expect(f.cancel).toHaveBeenCalledOnce();
    f.dispose();
  });

  it("leaves panels, left/middle clicks and subsequent ordinary right clicks usable", () => {
    const f = harness();
    expect(f.fire("pointerdown", false).defaultPrevented).toBe(false);
    expect(f.fire("pointerdown", true, 0).defaultPrevented).toBe(false);
    expect(f.fire("pointerdown", true, 1).defaultPrevented).toBe(false);
    expect(f.cancel).not.toHaveBeenCalled();
    f.fire("pointerdown"); f.fire("pointerup"); f.fire("contextmenu");
    f.downstream.mockClear();
    for (const type of ["pointerdown", "pointerup", "contextmenu"])
      expect(f.fire(type).defaultPrevented).toBe(false);
    expect(f.downstream).toHaveBeenCalledTimes(3);
    f.dispose();
  });

  it("also cancels a context-menu gesture without pointerdown and removes every listener", () => {
    const f = harness();
    expect(f.fire("contextmenu").defaultPrevented).toBe(true);
    expect(f.cancel).toHaveBeenCalledOnce();
    f.dispose();
    expect(f.fire("pointerdown").defaultPrevented).toBe(false);
    expect(f.fire("pointerup").defaultPrevented).toBe(false);
    expect(f.fire("contextmenu").defaultPrevented).toBe(false);
    expect(f.downstream).toHaveBeenCalledTimes(3);
  });
});
