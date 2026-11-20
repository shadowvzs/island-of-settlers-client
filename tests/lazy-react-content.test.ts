import { expect, it, vi } from "vitest";

import { createLazyReactContent } from "../src/app/components/lazy-react-content";

const flush = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };

it("unmounts mounted content and never mounts again after disposal", async () => {
  const content = { textContent: "" } as HTMLElement;
  const unmount = vi.fn();
  const mount = vi.fn(() => unmount);
  const lazy = createLazyReactContent(content, "Test", async () => mount);
  lazy.mount();
  await flush();
  expect(mount).toHaveBeenCalledTimes(1);
  lazy.dispose();
  expect(unmount).toHaveBeenCalledTimes(1);
  lazy.mount();
  await flush();
  expect(mount).toHaveBeenCalledTimes(1);
  lazy.dispose();
  expect(unmount).toHaveBeenCalledTimes(1);
});

it("unmounts a load that finishes after disposal without retaining it", async () => {
  const content = { textContent: "" } as HTMLElement;
  let resolve: ((mount: (content: HTMLElement) => () => void) => void) | undefined;
  const unmount = vi.fn();
  const load = () => new Promise<(content: HTMLElement) => () => void>(done => { resolve = done; });
  const lazy = createLazyReactContent(content, "Test", load);
  lazy.mount();
  await flush();
  lazy.dispose();
  resolve!(() => unmount);
  await flush();
  expect(unmount).toHaveBeenCalledTimes(1);
});
