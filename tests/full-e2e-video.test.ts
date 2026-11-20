import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import type { Page } from "playwright-core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { startClip as StartClip } from "../tools/e2e/full/video";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

let startClip: typeof StartClip;

beforeAll(async () => {
  // Unit files share a module graph: reporting tests may already have loaded the
  // encoder with the real spawn before this file's dependency mock was installed.
  vi.resetModules();
  ({ startClip } = await import("../tools/e2e/full/video"));
});
afterAll(() => {
  vi.doUnmock("node:child_process");
  vi.resetModules();
});

const setup = () => {
  const client = Object.assign(new EventEmitter(), { send: vi.fn<(method: string, params?: unknown) => Promise<object>>(async () => ({})), detach: vi.fn(async () => {}) });
  const encoder = Object.assign(new EventEmitter(), { stderr: new EventEmitter(), kill: vi.fn() });
  const stdin = Object.assign(new EventEmitter(), {
    writableLength: 0, write: vi.fn(), end: vi.fn(() => { encoder.emit("close", 0); })
  });
  Object.assign(encoder, { stdin });
  vi.mocked(spawn).mockReturnValue(encoder as unknown as ReturnType<typeof spawn>);
  const page = { context: () => ({ newCDPSession: async () => client }) } as unknown as Page;
  const frame = () => client.emit("Page.screencastFrame", { sessionId: 1, data: Buffer.from("real-frame").toString("base64") });
  return { client, encoder, frame, page, stdin };
};

beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); });
afterEach(() => { vi.useRealTimers(); });

describe("bounded real-frame case clips", () => {
  it("waits for a real CDP frame before an immediate stop can complete the clip", async () => {
    const { client, frame, page, stdin } = setup();
    let ready = false;
    const pending = startClip(page, "/tmp", "fast-case").then(clip => { ready = true; return clip; });
    await Promise.resolve(); await Promise.resolve();
    expect(ready).toBe(false);
    expect(stdin.write).not.toHaveBeenCalled();
    frame();
    const clip = await pending;
    expect(await clip.stop()).toEqual({ filename: "fast-case.webm", frames: 1 });
    expect(stdin.write).toHaveBeenCalledWith(Buffer.from("real-frame"));
    expect(client.detach).toHaveBeenCalledOnce();
    await clip.stop();
    expect(stdin.end).toHaveBeenCalledOnce();
  });

  it("times out missing real frames and cleans up CDP and encoder", async () => {
    const { client, page, stdin } = setup();
    const pending = startClip(page, "/tmp", "no-frames");
    const rejected = pending.catch(error => error);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await rejected).toMatchObject({ message: "No real screencast frame within 5 seconds" });
    expect(client.send).toHaveBeenCalledWith("Page.stopScreencast");
    expect(client.detach).toHaveBeenCalledOnce();
    expect(stdin.end).toHaveBeenCalledOnce();
    expect(stdin.write).not.toHaveBeenCalled();
  });

  it("cleans up when the browser refuses screencasting", async () => {
    const { client, page, stdin } = setup();
    client.send.mockImplementation(async method => {
      if (method === "Page.startScreencast") throw new Error("CDP unavailable");
      return {};
    });
    await expect(startClip(page, "/tmp", "refused")).rejects.toThrow("CDP unavailable");
    expect(client.detach).toHaveBeenCalledOnce();
    expect(stdin.end).toHaveBeenCalledOnce();
  });

  it("rejects an encoder startup error and releases the session", async () => {
    const { client, encoder, page } = setup();
    const pending = startClip(page, "/tmp", "bad-encoder");
    const rejected = pending.catch(error => error);
    await Promise.resolve(); await Promise.resolve();
    encoder.emit("error", new Error("encoder unavailable"));
    expect(await rejected).toMatchObject({ message: "encoder unavailable" });
    expect(client.detach).toHaveBeenCalledOnce();
  });
});
