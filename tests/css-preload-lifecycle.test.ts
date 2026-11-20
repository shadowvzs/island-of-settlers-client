import { describe, expect, it, vi } from "vitest";

import { cssPreloadLifecyclePlugin } from "../tools/css-preload-lifecycle-plugin";

const transform = (source: string, id = "\0vite/preload-helper.js") => {
  const hook = cssPreloadLifecyclePlugin().transform as Function;
  return hook.call({ error: (message: string) => { throw new Error(message); } }, source, id);
};
const source = `link.addEventListener("load", res);
link.addEventListener("error", () => rej(/* @__PURE__ */ new Error(\`Unable to preload CSS for \${dep}\`)));`;

describe("production CSS preload ownership", () => {
  for (const outcome of ["load", "error"]) {
    it(`releases both listeners after ${outcome} and preserves promise settlement`, async () => {
      const link = new EventTarget();
      const remove = vi.spyOn(link, "removeEventListener");
      const result = new Promise<void>((resolve, reject) => {
        new Function("link", "res", "rej", "dep", transform(source))(link, resolve, reject, "test.css");
      });
      link.dispatchEvent(new Event(outcome));
      if (outcome === "load") await expect(result).resolves.toBeUndefined();
      else await expect(result).rejects.toThrow("Unable to preload CSS for test.css");
      expect(remove.mock.calls.map(([event]) => event)).toEqual(["load", "error"]);
    });
  }
  it("leaves other modules alone and rejects an unreviewed upstream helper", () => {
    expect(transform(source, "ordinary-module.ts")).toBeNull();
    expect(() => transform("changed upstream helper")).toThrow("Vite CSS preload helper changed");
  });
});
