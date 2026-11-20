import { isPlainObject } from "../../../../island-of-settlers-shared/src/validation/index";
import { PROBE_TIMEOUT_MS } from "./constants";

/**
 * Where the backend lives (build/runtime config). Without both URLs the game is standalone: the browser save,
 * no network and no account UI (owner rule 2026-10-22).
 */
export interface BackendConfig {
  /** Save API base URL (`VITE_API_URL`), without a trailing slash. */
  apiUrl: string;
  /** Identity service base URL (`VITE_IDENTITY_URL`), without a trailing slash. */
  identityUrl: string;
}

export interface BackendEnv {
  VITE_API_URL?: string;
  VITE_IDENTITY_URL?: string;
}

const baseUrl = (value: string | undefined) => value?.trim().replace(/\/+$/, "") ?? "";

/** Both service URLs, or null when either is missing (standalone). */
export const readBackendConfig = (env: BackendEnv): BackendConfig | null => {
  const apiUrl = baseUrl(env.VITE_API_URL), identityUrl = baseUrl(env.VITE_IDENTITY_URL);
  if (!apiUrl || !identityUrl) return null;
  return { apiUrl, identityUrl };
};

/** The body of `GET /config` when it is the public runtime config (its feature flags are an object). */
const readConfigBody = async (response: Response) => {
  if (!response.ok) return null;
  const body: unknown = await response.json();
  return isPlainObject(body) && isPlainObject(body.features) ? body : null;
};

export interface ProbeOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/**
 * The public runtime config when the save API serves it and reports ready (database and schema) within the
 * timeout. Any failure (network, timeout, error status, malformed config) is null: the game then stays standalone.
 */
export const probeBackendConfig = async (config: BackendConfig, options: ProbeOptions = {}) => {
  const request = options.fetch ?? fetch;
  const signal = AbortSignal.timeout(options.timeoutMs ?? PROBE_TIMEOUT_MS);
  const get = (path: string) =>
    request(`${config.apiUrl}${path}`, { cache: "no-store", credentials: "omit", signal });
  try {
    const [configResponse, readyResponse] = await Promise.all([get("/config"), get("/ready")]);
    return readyResponse.ok ? await readConfigBody(configResponse) : null;
  } catch {
    return null;
  }
};
