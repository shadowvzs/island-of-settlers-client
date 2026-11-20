import { expect, it, vi } from "vitest";

import { createHotkeyHintVisibility } from "../src/app/settings/hotkeys/hint-visibility";

it("persists hint visibility separately from bindings and restores it without disabling actions", () => {
  const persist = vi.fn(), visibility = createHotkeyHintVisibility(null, persist);
  expect(visibility.getSnapshot()).toBe(true);
  visibility.toggle(); expect(visibility.getSnapshot()).toBe(false);
  expect(persist).toHaveBeenLastCalledWith("hidden");
  const restored = createHotkeyHintVisibility(persist.mock.lastCall![0], persist);
  expect(restored.getSnapshot()).toBe(false);
  restored.toggle(); expect(restored.getSnapshot()).toBe(true);
  expect(persist).toHaveBeenLastCalledWith("visible");
});
