import { describe, expect, it, type Mock, vi } from "vitest";

import type { SaveCheckpoint } from "../src/app/save-store/save-coordinator";
import { createSessionLifecycle } from "../src/app/session-lifecycle";
import {
  type BackgroundResumeAttempt, type BackgroundResumeResult, createBackgroundSession
} from "../src/app/settlement/background-session";
import type { TabResumeContext } from "../src/app/settlement/tab-resume";

const CONTEXT: TabResumeContext = {
  accountId: null, generation: 0, islandId: null, location: "browser", slotId: null, worldSeed: 7
};
const SAVED: SaveCheckpoint = { joined: false, ran: true, saved: true };
const CLEAN: SaveCheckpoint = { joined: false, ran: false, saved: false };
const FAILED: SaveCheckpoint = { error: new Error("disk full"), joined: false, ran: true, saved: false };

const deferred = <T>() => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>(resolvePromise => { resolve = resolvePromise; });
  return { promise, resolve };
};

const setup = (overrides: {
  context?: () => TabResumeContext;
  gameNow?: () => number;
  reload?: () => Promise<void>;
  sameContext?: (context: TabResumeContext) => boolean;
  save?: () => Promise<SaveCheckpoint>;
  resume?: Mock<(attempt: BackgroundResumeAttempt) => BackgroundResumeResult | Promise<BackgroundResumeResult>>;
} = {}) => {
  const target = new EventTarget() as EventTarget & { hidden: boolean }; target.hidden = false;
  const page = new EventTarget(), notify = vi.fn(), pauseAutosave = vi.fn(), reload = vi.fn(async () => undefined);
  const resetFrameTime = vi.fn();
  const resume = overrides.resume ?? vi.fn(async (): Promise<BackgroundResumeResult> => "retained");
  const session = createBackgroundSession({
    context: overrides.context ?? (() => CONTEXT),
    document: target,
    gameNow: overrides.gameNow ?? (() => 1000),
    notify,
    now: () => 1000,
    page: page as unknown as Window,
    pauseAutosave,
    reload: overrides.reload ?? reload,
    resetFrameTime,
    resume,
    sameContext: overrides.sameContext ?? (() => true),
    save: overrides.save ?? (async () => SAVED)
  });
  const hide = () => { target.hidden = true; target.dispatchEvent(new Event("visibilitychange")); };
  const show = () => { target.hidden = false; target.dispatchEvent(new Event("visibilitychange")); };
  return { hide, notify, page, pauseAutosave, reload, resetFrameTime, resume, session, show, target };
};

describe("tab hide/show checkpoint", () => {
  it("saves once at one hide boundary, waits for it, then resumes and unpauses once", async () => {
    const gate = deferred<SaveCheckpoint>(), save = vi.fn(() => gate.promise);
    const { hide, pauseAutosave, resetFrameTime, resume, session, show } = setup({ save });
    hide(); hide();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    show();
    expect(resume).not.toHaveBeenCalled();
    gate.resolve(SAVED);
    await vi.waitFor(() => expect(resume).toHaveBeenCalledTimes(1));
    expect(resume.mock.calls[0]![0]).toMatchObject({ context: CONTEXT, gameNow: 1000, save: SAVED });
    expect(pauseAutosave.mock.calls).toEqual([[true], [false]]);
    expect(resetFrameTime).toHaveBeenCalled();
    session.dispose();
  });

  it("treats a clean game as a valid checkpoint and still reconciles the interval", async () => {
    const { hide, notify, pauseAutosave, resume, session, show } = setup({ save: async () => CLEAN });
    hide(); show();
    await vi.waitFor(() => expect(resume).toHaveBeenCalledTimes(1));
    expect((resume.mock.calls[0]![0] as { save: SaveCheckpoint }).save).toEqual(CLEAN);
    expect(notify).not.toHaveBeenCalled();
    expect(pauseAutosave.mock.calls).toEqual([[true], [false]]);
    session.dispose();
  });

  it("resumes a failed save and lets autosave retry instead of reloading over the live session", async () => {
    const { hide, notify, pauseAutosave, resume, session, show } = setup({ save: async () => FAILED });
    hide(); show();
    await vi.waitFor(() => expect(resume).toHaveBeenCalledTimes(1));
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Could not save"));
    expect(pauseAutosave.mock.calls).toEqual([[true], [false]]);
    session.dispose();
  });

  it("marks a checkpoint that joined an in-flight save", async () => {
    const gate = deferred<SaveCheckpoint>();
    const { hide, resume, session, show } = setup({ save: () => gate.promise });
    hide(); show();
    gate.resolve({ ...SAVED, joined: true });
    await vi.waitFor(() => expect(resume).toHaveBeenCalledTimes(1));
    expect((resume.mock.calls[0]![0] as { save: SaveCheckpoint }).save.joined).toBe(true);
    session.dispose();
  });
});

describe("repeated visibility changes", () => {
  it("joins repeated shows to one resume and starts a fresh interval afterwards", async () => {
    const gate = deferred<"retained">(), resume = vi.fn(() => gate.promise);
    const { hide, pauseAutosave, session, show } = setup({ resume });
    hide(); show(); show(); show();
    await vi.waitFor(() => expect(resume).toHaveBeenCalledTimes(1));
    gate.resolve("retained");
    await vi.waitFor(() => expect(pauseAutosave).toHaveBeenLastCalledWith(false));
    expect(resume).toHaveBeenCalledTimes(1);
    hide(); show();
    await vi.waitFor(() => expect(resume).toHaveBeenCalledTimes(2));
    expect(pauseAutosave.mock.calls).toEqual([[true], [false], [true], [false]]);
    session.dispose();
  });

  it("keeps a new hide interval recorded during an unfinished resume and reconciles it once", async () => {
    const first = deferred<"retained">();
    const resume = vi.fn().mockImplementationOnce(() => first.promise)
      .mockResolvedValue("retained" as const);
    const save = vi.fn(async () => SAVED);
    const { hide, pauseAutosave, session, show } = setup({ resume, save });
    hide(); show();
    await vi.waitFor(() => expect(resume).toHaveBeenCalledTimes(1));
    hide(); show();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    first.resolve("retained");
    await vi.waitFor(() => expect(resume).toHaveBeenCalledTimes(2));
    expect(resume.mock.calls[1]![0]).toMatchObject({ gameNow: 1000 });
    expect(pauseAutosave.mock.calls).toEqual([[true], [false]]);
    session.dispose();
  });
});

describe("back/forward-cache restoration", () => {
  it("resumes from a persisted pagehide even when no visibility change preceded it", async () => {
    const { page, pauseAutosave, resume, session, target } = setup();
    target.hidden = true;
    page.dispatchEvent(Object.assign(new Event("pagehide"), { persisted: true }));
    target.hidden = false;
    page.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }));
    await vi.waitFor(() => expect(resume).toHaveBeenCalledTimes(1));
    expect(pauseAutosave.mock.calls).toEqual([[true], [false]]);
    session.dispose();
  });
});

describe("fallbacks and failures", () => {
  it("falls back to the committed-save reload when the session changed", async () => {
    const { hide, notify, pauseAutosave, reload, resume, session, show } = setup({
      sameContext: () => false
    });
    hide(); show();
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(resume).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("island changed"));
    expect(pauseAutosave.mock.calls).toEqual([[true], [false]]);
    session.dispose();
  });

  it("resets the flags and autosave after a failed resume so a later cycle works", async () => {
    const resume = vi.fn().mockRejectedValueOnce(new Error("authority unavailable"))
      .mockResolvedValue("retained" as const);
    const { hide, notify, pauseAutosave, reload, session, show } = setup({ resume });
    hide(); show();
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("authority unavailable"));
    expect(pauseAutosave.mock.calls).toEqual([[true], [false]]);
    hide(); show();
    await vi.waitFor(() => expect(resume).toHaveBeenCalledTimes(2));
    expect(pauseAutosave.mock.calls).toEqual([[true], [false], [true], [false]]);
    session.dispose();
  });
});

it("stops observing when its session owner disposes the retained background listener", () => {
  const save = vi.fn(async () => SAVED), lifecycle = createSessionLifecycle();
  const { hide, session } = setup({ save });
  lifecycle.retain(session.dispose);
  lifecycle.dispose();
  hide();
  expect(save).not.toHaveBeenCalled();
});
