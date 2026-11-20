import type { Plugin } from "vite";

/** Vite's CSS event listeners otherwise keep fulfilled import promises and island closures alive. */
export const cssPreloadLifecyclePlugin = (): Plugin => ({
  name: "css-preload-lifecycle",
  apply: "build",
  enforce: "pre",
  transform(source, id) {
    if (id !== "\0vite/preload-helper.js") return null;
    const load = 'link.addEventListener("load", res);';
    const error = 'link.addEventListener("error", () => rej(/* @__PURE__ */ new Error(`Unable to preload CSS for ${dep}`)));';
    if (!source.includes(load) || !source.includes(error))
      this.error("Vite CSS preload helper changed; review its listener lifetime before building");
    return source.replace(load, `
      const cleanup = () => {
        link.removeEventListener("load", onLoad);
        link.removeEventListener("error", onError);
      };
      const onLoad = () => { cleanup(); res(); };
      const onError = () => {
        cleanup();
        rej(new Error(\`Unable to preload CSS for \${dep}\`));
      };
      link.addEventListener("load", onLoad);`)
      .replace(error, 'link.addEventListener("error", onError);');
  }
});
