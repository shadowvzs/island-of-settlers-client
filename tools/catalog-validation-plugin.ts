import type { Plugin } from "vite";

import { assertContentCatalog } from "../../island-of-settlers-shared/server/catalog-check.ts";

/**
 * Validates the content catalog data once when a build or the dev server starts (owner 2026-11-11: build, test,
 * dev and server start; never inside the production client). An invalid catalog stops the build.
 */
export const catalogValidationPlugin = (): Plugin => ({
  buildStart: () => { assertContentCatalog(); },
  name: "content-catalog-validation"
});
