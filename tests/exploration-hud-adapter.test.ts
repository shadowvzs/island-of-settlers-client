import { afterEach, describe, expect, it, vi } from "vitest";

import { createIdleExplorationSnapshot, type ExplorationUiSnapshot } from "../src/app/exploration/contracts";
import { createExplorationUiAdapter } from "../src/app/exploration/ui/adapter";
import {
  attachExplorationEntry,
  getExplorationEntryPresence,
  requestExplorationEntry,
  subscribeExplorationEntry,
  updateExplorationEntry
} from "../src/app/exploration/ui/entry-store";
import type { ExplorationUiMountContext } from "../src/app/exploration/ui/host";
import {
  createExplorationHudScope,
  EXPLORATION_HUD_ATTRIBUTE
} from "../src/app/exploration/ui/hud-scope";
import { createExplorationUiStore } from "../src/app/exploration/ui/ui-store";

class FakeRoot {
  private values = new Map<string, string>();
  removeCalls = 0;
  setCalls = 0;

  constructor(initial?: string) {
    if (initial !== undefined) this.values.set(EXPLORATION_HUD_ATTRIBUTE, initial);
  }

  getAttribute(name: string) {
    return this.values.get(name) ?? null;
  }

  removeAttribute(name: string) {
    this.removeCalls++;
    this.values.delete(name);
  }

  setAttribute(name: string, value: string) {
    this.setCalls++;
    this.values.set(name, value);
  }
}

const homeSnapshot = (changes: Partial<ExplorationUiSnapshot> = {}): ExplorationUiSnapshot => ({
  ...createIdleExplorationSnapshot({ eligible: true }),
  canEnter: true,
  ...changes
});

const cleanup: (() => void)[] = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});

describe("exploration HUD scope", () => {
  it("hides preparing/active phases and restores the root attribute exactly once", () => {
    const root = new FakeRoot();
    const scope = createExplorationHudScope(root);
    scope.sync("idle");
    expect(scope.hidden()).toBe(false);
    expect(root.setCalls).toBe(0);

    scope.sync("preparing");
    expect(scope.hidden()).toBe(false);
    expect(root.getAttribute(EXPLORATION_HUD_ATTRIBUTE)).toBeNull();
    expect(root.setCalls).toBe(0);

    scope.sync("entering");
    expect(scope.hidden()).toBe(true);
    expect(root.getAttribute(EXPLORATION_HUD_ATTRIBUTE)).toBe("hidden");
    scope.sync("possessed");
    expect(root.setCalls).toBe(1);

    scope.sync("cooldown");
    expect(scope.hidden()).toBe(false);
    expect(root.getAttribute(EXPLORATION_HUD_ATTRIBUTE)).toBeNull();
    expect(scope.restoreCount()).toBe(1);
    scope.dispose();
    scope.dispose();
    expect(scope.restoreCount()).toBe(1);
    expect(root.removeCalls).toBe(1);
  });

  it("restores a pre-existing root attribute on forced disposal", () => {
    const root = new FakeRoot("legacy");
    const scope = createExplorationHudScope(root);
    scope.sync("returning");
    expect(root.getAttribute(EXPLORATION_HUD_ATTRIBUTE)).toBe("hidden");
    scope.dispose();
    expect(root.getAttribute(EXPLORATION_HUD_ATTRIBUTE)).toBe("legacy");
    expect(scope.restoreCount()).toBe(1);
    scope.dispose();
    expect(scope.restoreCount()).toBe(1);
  });

  it("is a safe no-op without a document root", () => {
    const scope = createExplorationHudScope(null);
    scope.sync("possessed");
    expect(scope.hidden()).toBe(true);
    scope.dispose();
    expect(scope.hidden()).toBe(false);
  });
});

describe("exploration entry bridge", () => {
  it("keeps the entry action available only for eligible, idle snapshots", () => {
    const onEnter = vi.fn();
    const detach = attachExplorationEntry({ onEnter, snapshot: homeSnapshot() });
    expect(getExplorationEntryPresence()).toBe(true);
    requestExplorationEntry();
    expect(onEnter).toHaveBeenCalledTimes(1);

    const cooldown = homeSnapshot({ canEnter: false, cooldownInMs: 2_000, phase: "cooldown" });
    const detachCooldown = attachExplorationEntry({ onEnter, snapshot: cooldown });
    expect(getExplorationEntryPresence()).toBe(true);
    requestExplorationEntry();
    expect(onEnter).toHaveBeenCalledTimes(1);

    detachCooldown();
    detach();
    expect(getExplorationEntryPresence()).toBe(false);
    requestExplorationEntry();
    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  it("does not re-render the corner for progress-only snapshot churn", () => {
    const detach = attachExplorationEntry({ onEnter: vi.fn(), snapshot: homeSnapshot() });
    cleanup.push(detach);
    const listener = vi.fn();
    const unsubscribe = subscribeExplorationEntry(listener);
    updateExplorationEntry(homeSnapshot({ progress: 0.6 }));
    expect(listener).not.toHaveBeenCalled();
    updateExplorationEntry(homeSnapshot({ canEnter: false }));
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});

describe("exploration UI adapter", () => {
  const makeAdapter = (onEnter = vi.fn(async () => ({ ok: true }))) => {
    const root = new FakeRoot();
    const unmount = vi.fn();
    const host = { mount: vi.fn((_context: ExplorationUiMountContext) => unmount) };
    const adapter = createExplorationUiAdapter({
      actions: { onEnter, onLeave: vi.fn(), onSpyglass: vi.fn() },
      host,
      input: false,
      root,
      reducedMotion: true
    });
    cleanup.push(adapter.dispose);
    return { adapter, host, onEnter, root, unmount };
  };

  it("publishes immutable snapshots, mounts the overlay lazily and restores the HUD", () => {
    const { adapter, host, root, unmount } = makeAdapter();
    adapter.publish(homeSnapshot());
    expect(host.mount).not.toHaveBeenCalled();
    expect(getExplorationEntryPresence()).toBe(true);
    const idle = adapter.store.getSnapshot();
    expect(Object.isFrozen(idle)).toBe(true);
    expect(Object.isFrozen(idle.eligibility)).toBe(true);

    adapter.publish(homeSnapshot({ canEnter: false, phase: "preparing", progress: 0.2 }));
    expect(host.mount).toHaveBeenCalledTimes(1);
    expect(adapter.gate.snapshot()).toMatchObject({ move: false, suppressNormal: false });
    expect(root.getAttribute(EXPLORATION_HUD_ATTRIBUTE)).toBeNull();
    expect(adapter.store.getSnapshot().phase).toBe("preparing");
    expect(host.mount.mock.calls[0]![0]).toMatchObject({ input: null, reducedMotion: true });

    adapter.publish(homeSnapshot({ canEnter: false, phase: "entering" }));
    expect(root.getAttribute(EXPLORATION_HUD_ATTRIBUTE)).toBe("hidden");
    expect(adapter.gate.snapshot()).toMatchObject({ suppressNormal: true });

    adapter.publish(homeSnapshot({ canEnter: false, phase: "possessed" }));
    expect(host.mount).toHaveBeenCalledTimes(1);
    expect(adapter.gate.snapshot()).toMatchObject({ move: true, look: true, suppressNormal: true });

    adapter.publish(homeSnapshot({ cooldownInMs: 2_000, phase: "cooldown" }));
    expect(root.getAttribute(EXPLORATION_HUD_ATTRIBUTE)).toBeNull();
    expect(adapter.hudScope.restoreCount()).toBe(1);

    adapter.dispose();
    expect(unmount).toHaveBeenCalledTimes(1);
    expect(root.getAttribute(EXPLORATION_HUD_ATTRIBUTE)).toBeNull();
    expect(adapter.hudScope.restoreCount()).toBe(1);
    expect(getExplorationEntryPresence()).toBe(false);
    adapter.dispose();
    expect(unmount).toHaveBeenCalledTimes(1);
    expect(adapter.store.getSnapshot().phase).toBe("idle");
  });

  it("restores an active HUD when disposed during a session", () => {
    const { adapter, root } = makeAdapter();
    adapter.publish(homeSnapshot({ canEnter: false, phase: "entering" }));
    expect(adapter.hudScope.hidden()).toBe(true);
    adapter.dispose();
    expect(adapter.hudScope.hidden()).toBe(false);
    expect(adapter.hudScope.restoreCount()).toBe(1);
    expect(root.getAttribute(EXPLORATION_HUD_ATTRIBUTE)).toBeNull();
  });

  it("shows a non-destructive refusal notice and clears it when the next entry starts", async () => {
    const onEnter = vi.fn(async () => ({ ok: false, reason: "no-safe-spawn" }));
    const { adapter, host } = makeAdapter(onEnter);
    adapter.publish(homeSnapshot());
    requestExplorationEntry();
    await Promise.resolve();
    await Promise.resolve();
    expect(adapter.store.getSnapshot().notice).toBe(
      "No safe place to start exploring was found. Nothing was changed."
    );
    expect(host.mount).toHaveBeenCalledTimes(1);

    adapter.publish(homeSnapshot({ canEnter: false, phase: "preparing", progress: 0.1 }));
    expect(adapter.store.getSnapshot().notice).toBeUndefined();
  });

  it("turns a thrown entry action into a safe refusal instead of leaving a broken state", async () => {
    const onEnter = vi.fn(async () => { throw new Error("boom"); });
    const { adapter } = makeAdapter(onEnter);
    adapter.publish(homeSnapshot());
    requestExplorationEntry();
    await Promise.resolve();
    await Promise.resolve();
    expect(adapter.store.getSnapshot().notice).toBe("The explorer could not start. Nothing was changed.");
    expect(adapter.store.getSnapshot().phase).toBe("idle");
  });

  it("stores a frozen idle snapshot after store disposal", () => {
    const store = createExplorationUiStore();
    const snapshot = store.publish(homeSnapshot({ notice: "Notice" }));
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(snapshot.notice).toBe("Notice");
    store.dispose();
    expect(store.getSnapshot()).toMatchObject({ canEnter: false, phase: "idle", spyglass: false });
    expect(store.getSnapshot().notice).toBeUndefined();
  });
});
