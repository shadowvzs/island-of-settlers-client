import type {
  GameSettings, GameSettingsRevision
} from "../../../../island-of-settlers-shared/src/game-settings/game-settings";
import {
  hasGameSettingsErrors, validateGameSettings
} from "../../../../island-of-settlers-shared/src/game-settings/game-settings-issues";
import { isGameSettings } from "../../../../island-of-settlers-shared/src/game-settings/game-settings-shape";
import { isPlainObject } from "../../../../island-of-settlers-shared/src/validation/index";
import type { BackendConfig } from "../backend/backend-config";
import { CACHED_SETTINGS_KEY, SETTINGS_FETCH_TIMEOUT_MS } from "./constants";

/**
 * Where the browser learns the deployment's game settings before sign-in (plan §7.2 step 1, lane GS3a): the
 * server's public `GET /v1/game-settings` when a backend answers (cached as a boot value), else the cached copy,
 * else the bundled build file (`public/game-settings.json`), else none (legacy: online with a home, today's game).
 * A signed-in online session later adopts the lease grant, which wins over this public copy.
 */
export type GameSettingsOrigin = "bundled" | "cached" | "none" | "server";

export interface BootGameSettings {
  origin: GameSettingsOrigin;
  /** The server's revision id (server and cached copies); absent for the bundled file. */
  revision?: string;
  /** Null = no settings known: today's game (`LEGACY_SIM_RULES`). */
  settings: GameSettings | null;
}

export interface SettingsSourcePorts {
  /** The bundled build file's JSON, or null when the build ships none. */
  readBundled(): Promise<unknown>;
  readCached(): Promise<string | null>;
  /** The server's answer; null or a throw when no backend answers. */
  readServer(): Promise<unknown>;
  writeCached(json: string): Promise<void>;
}

const NO_SETTINGS: BootGameSettings = Object.freeze({ origin: "none", settings: null });

/** Well-shaped settings without a value error; anything else is ignored (never trusted, never thrown). */
const usableSettings = (value: unknown): GameSettings | null =>
  isGameSettings(value) && !hasGameSettingsErrors(validateGameSettings(value)) ? value : null;

/** A `{ revision, settings }` answer (server or cached copy), else null. */
const usableRevision = (value: unknown): GameSettingsRevision | null => {
  if (!isPlainObject(value) || typeof value.revision !== "string") return null;
  const settings = usableSettings(value.settings);
  return settings && { revision: value.revision, settings };
};

const parsedJson = (json: string | null): unknown => {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
};

const safely = async <Value>(read: () => Promise<Value>): Promise<Value | null> => {
  try {
    return await read();
  } catch {
    return null;
  }
};

const serverSettings = async (ports: SettingsSourcePorts): Promise<BootGameSettings | null> => {
  const answer = usableRevision(await safely(ports.readServer));
  if (!answer) return null;
  await safely(() => ports.writeCached(JSON.stringify(answer)));
  return { origin: "server", ...answer };
};

const cachedSettings = async (ports: SettingsSourcePorts): Promise<BootGameSettings | null> => {
  const answer = usableRevision(parsedJson(await safely(ports.readCached)));
  return answer && { origin: "cached", ...answer };
};

const bundledSettings = async (ports: SettingsSourcePorts): Promise<BootGameSettings | null> => {
  const settings = usableSettings(await safely(ports.readBundled));
  return settings && { origin: "bundled", settings };
};

/** The first usable source in the order server → cached → bundled → none. */
export const resolveBootGameSettings = async (ports: SettingsSourcePorts): Promise<BootGameSettings> =>
  await serverSettings(ports) ?? await cachedSettings(ports) ?? await bundledSettings(ports) ?? NO_SETTINGS;

const fetchJson = async (url: string, fetcher: typeof fetch) => {
  const response = await fetcher(url, { cache: "no-store", credentials: "omit",
    signal: AbortSignal.timeout(SETTINGS_FETCH_TIMEOUT_MS) });
  return response.ok ? await response.json() as unknown : null;
};

interface BrowserSettingsSourceOptions {
  backend: BackendConfig | null;
  /** Boot values of the browser game database. */
  database: { readValue(key: string): Promise<string | null>; writeValue(key: string, value: string): Promise<void> };
  /** The bundled file's URL (the build's base path + `game-settings.json`). */
  bundledUrl: string;
  fetcher?: typeof fetch;
}

/** The browser's ports: the public route (only with a detected backend), the boot value and the bundled file. */
export const browserSettingsSource = (
  { backend, bundledUrl, database, fetcher = fetch }: BrowserSettingsSourceOptions
): SettingsSourcePorts => ({
  readBundled: () => fetchJson(bundledUrl, fetcher),
  readCached: () => database.readValue(CACHED_SETTINGS_KEY),
  readServer: async () => backend ? fetchJson(`${backend.apiUrl}/v1/game-settings`, fetcher) : null,
  writeCached: json => database.writeValue(CACHED_SETTINGS_KEY, json)
});
