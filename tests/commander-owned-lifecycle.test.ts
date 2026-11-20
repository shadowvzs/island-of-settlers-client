import { globSync, readFileSync } from "node:fs";
import type { BrowserContext, Page } from "playwright-core";
import { transformWithOxc } from "vite";
import { expect, it, vi } from "vitest";

import { installCommanderOwnedLifecycle } from "../tools/bench/commander-owned-lifecycle";

it("instruments actual Vite-transformed ownership sources without starting a browser", async () => {
  const files = globSync("src/**/*.ts"), patched: string[] = [];
  const context = { addInitScript: async () => {} } as unknown as BrowserContext;
  const page = { route: async (pattern: string, handler: (route: unknown) => Promise<void>) => {
    const file = files.find(path => path.endsWith(`/${pattern.slice(3, -1)}`));
    expect(file, pattern).toBeDefined();
    const transformed = await transformWithOxc(readFileSync(file!, "utf8"), file!);
    await handler({ fetch: async () => ({ text: async () => transformed.code }),
      fulfill: async ({ body }: { body: string }) => {
        expect(body).toContain("__commanderOwned");
        await transformWithOxc(body, file!.replace(/\.ts$/, ".js"));
        patched.push(file!);
      } });
  } } as unknown as Page;
  await installCommanderOwnedLifecycle(context, page);
  expect(patched).toHaveLength(8);
});

it("does not turn an undisposed weakly collected private resource into a passing zero", async () => {
  let initialize!: () => void;
  const context = { addInitScript: async (fn: () => void) => { initialize = fn; } } as unknown as BrowserContext;
  const page = { route: async () => {} } as unknown as Page;
  await installCommanderOwnedLifecycle(context, page);
  const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;
  const host: any = new EventTarget();
  vi.stubGlobal("window", host); vi.stubGlobal("document", new EventTarget());
  vi.stubGlobal("WeakRef", class { deref() { return undefined; } });
  try {
    initialize();
    const texture = Object.assign(new EventTarget(), { isTexture: true, image: { data: new Uint8Array(16) } });
    host.__commanderOwned.own(texture, "private-texture");
    expect(host.__commanderOwned.snapshot()).toMatchObject({ live: { "private-texture": 1 },
      imageBytes: { "private-texture": 16 }, orphanedUndisposed: 1 });
    texture.dispatchEvent(new Event("dispose"));
    expect(host.__commanderOwned.snapshot()).toMatchObject({ live: {}, orphanedUndisposed: 0 });
  } finally {
    EventTarget.prototype.addEventListener = add; EventTarget.prototype.removeEventListener = remove;
    vi.unstubAllGlobals();
  }
});
