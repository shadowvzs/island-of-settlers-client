import {
  readSeasonSettings,
  type SeasonMode,
  type SeasonSettings,
  type VisualSeason
} from "../../../../../island-of-settlers-shared/src/appearance/season-calendar";
import { createApiTransport, readApiError, type SaveApiOptions } from "../../save-store/save-api-client";

export interface AppearanceResponse {
  globalWinter: boolean;
  /** Absent from servers before the season mode (SEASONS S0): the client then derives a fixed season. */
  season: SeasonSettings;
  /** Server time (ms) of the answer, for the season blend clock; absent from older servers. */
  serverNow?: number;
}

export interface SeasonChange {
  fixedSeason?: VisualSeason;
  seasonMode?: SeasonMode;
  transitionSeconds?: number;
}

const legacySeason = (globalWinter: boolean): SeasonSettings => {
  const season = globalWinter ? "winter" : "summer";
  return { changedAt: 0, fixedSeason: season, mode: "none", previousSeason: season, transitionSeconds: 0 };
};

const readAppearance = async (response: Response): Promise<AppearanceResponse> => {
  if (!response.ok) throw await readApiError(response);
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || !("globalWinter" in body) ||
    typeof body.globalWinter !== "boolean") throw new Error("Invalid appearance response");
  const season = "season" in body ? readSeasonSettings(body.season) : legacySeason(body.globalWinter);
  if (!season) throw new Error("Invalid appearance season");
  const serverNow = "serverNow" in body && typeof body.serverNow === "number" ? body.serverNow : undefined;
  return { globalWinter: body.globalWinter, season, serverNow };
};

export interface AppearanceApiOptions extends Pick<SaveApiOptions, "apiUrl" | "getAccessToken" | "renewAccessToken"> {
  fetch?: typeof fetch;
}

/** Public reads also work for guests; admin writes reuse the account token/renewal transport. */
export const createAppearanceApi = (options: Omit<AppearanceApiOptions, "getAccessToken"> & {
  getAccessToken?: AppearanceApiOptions["getAccessToken"];
}) => {
  const request = options.fetch ?? fetch;
  const send = async (body: SeasonChange | { globalWinter: boolean }) => {
    if (!options.getAccessToken) throw new Error("Administrator sign-in required");
    const transport = createApiTransport({ ...options, getAccessToken: options.getAccessToken });
    return readAppearance(await transport.send("PUT", "/v1/debug/appearance", { body }));
  };
  return {
    read: async () => readAppearance(await request(`${options.apiUrl}/v1/appearance`, {
      cache: "no-store", credentials: "omit"
    })),
    setGlobalWinter: (globalWinter: boolean) => send({ globalWinter }),
    setSeason: (change: SeasonChange) => send(change)
  };
};

export type AppearanceApiConfig = Parameters<typeof createAppearanceApi>[0];
