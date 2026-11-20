/**
 * Worker game assets (from the generator repository's game exports): served under `workers/` by
 * the worker assets plugin in dev and copied there by the build (only production assets).
 */
export const WORKER_ASSET_BASE = new URL("./workers/", document.baseURI).href;
