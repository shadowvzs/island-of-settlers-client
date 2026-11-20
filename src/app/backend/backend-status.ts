import { createExternalStore, type ReadableStore } from "../components/ui-store";
import {
  type BackendConfig, type BackendEnv, probeBackendConfig, type ProbeOptions, readBackendConfig
} from "./backend-config";
import { ALL_ONLINE_FEATURES } from "./constants";
import { publishOnlineFeatures, readOnlineFeatures } from "./online-features";

const status = createExternalStore(false);
/** Vite inlines both at build time; a deployment without them is standalone. */
const buildEnv = (): BackendEnv => ({
  VITE_API_URL: import.meta.env.VITE_API_URL,
  VITE_IDENTITY_URL: import.meta.env.VITE_IDENTITY_URL
});

/**
 * The one place features ask whether online play exists (`useSyncExternalStore`-ready). False until startup
 * detection found a configured, reachable and ready backend; standalone play never sees it change.
 */
export const backendStatus: ReadableStore<boolean> = status;

/**
 * Startup detection: no configured backend is standalone at once (no request); a configured one is probed with
 * a short timeout. Publishes `backendAvailable` and the server's online feature switches (standalone: today's
 * set); resolves to the available backend's config (else null).
 */
export const detectBackend = async (
  env: BackendEnv = buildEnv(), options?: ProbeOptions
): Promise<BackendConfig | null> => {
  const config = readBackendConfig(env);
  const runtimeConfig = config ? await probeBackendConfig(config, options) : null;
  status.set(runtimeConfig !== null);
  publishOnlineFeatures(runtimeConfig ? readOnlineFeatures(runtimeConfig) : ALL_ONLINE_FEATURES);
  return runtimeConfig ? config : null;
};
