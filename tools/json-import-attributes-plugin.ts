import type { Plugin } from "vite";

const DYNAMIC_JSON_ATTRIBUTE = /,\s*\{\s*with:\s*\{\s*type:\s*"json"\s*\}\s*\}/g;
const STATIC_JSON_ATTRIBUTE = /(\.json")\s+with\s*\{\s*type:\s*"json"\s*\}/g;

/**
 * The shared catalog imports its JSON sidecars with `with { type: "json" }` so plain Node (`node --test`) can load
 * them. The Vite dev server serves JSON as a JavaScript module, which the browser rejects for a JSON-typed import
 * ("Expected a JSON module script"), so the dev server drops the attribute; production builds bundle the JSON.
 */
export const jsonImportAttributesPlugin = (): Plugin => ({
  apply: "serve",
  enforce: "pre",
  name: "json-import-attributes",
  transform: (code, id) => {
    if (!id.includes("island-of-settlers-shared") || !code.includes("type: \"json\"")) return undefined;
    return {
      code: code.replace(DYNAMIC_JSON_ATTRIBUTE, "").replace(STATIC_JSON_ATTRIBUTE, "$1"),
      map: null
    };
  }
});
