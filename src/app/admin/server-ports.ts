import type { GameSettings } from "../../../../island-of-settlers-shared/src/game-settings/game-settings";
import { isPlainObject } from "../../../../island-of-settlers-shared/src/validation/index";
import type { IdentityClient } from "../account/identity-client";
import type { BackendConfig } from "../backend/backend-config";
import type {
  AccountStatusChange, AdminAccount, RevisionInfo, SaveSettingsResult, SettingsPort, SettingsSnapshot, UsersPort
} from "./admin-ports";
import { FOOTER_REVISION_LIMIT, HTTP_UNAUTHORIZED, USER_LIST_LIMIT } from "./constants";

export type AuthorizedFetch = (url: string, init?: RequestInit) => Promise<Response>;

/** A request with the administrator's access token; one renewal and retry after a 401 (expired token). */
export const createAuthorizedFetch = (identity: IdentityClient, fetcher: typeof fetch = fetch): AuthorizedFetch => {
  const send = async (url: string, init: RequestInit) => fetcher(url, {
    ...init,
    cache: "no-store",
    headers: { ...init.headers, Authorization: `Bearer ${await identity.accessToken()}` }
  });
  return async (url, init = {}) => {
    const response = await send(url, init);
    if (response.status !== HTTP_UNAUTHORIZED) return response;
    await identity.renew();
    return send(url, init);
  };
};

export const jsonBody = (body: unknown): RequestInit => ({
  body: JSON.stringify(body), headers: { "Content-Type": "application/json" }
});

/** The server's error message (`{ message }`) or a status line. */
const failureMessage = async (response: Response) => {
  const body = await response.json().catch(() => null) as unknown;
  if (isPlainObject(body) && typeof body.message === "string") return body.message;
  return `The server answered ${response.status}.`;
};

export const readJson = async <T>(response: Response): Promise<T> => {
  if (!response.ok) throw new Error(await failureMessage(response));
  return await response.json() as T;
};

/** Issue messages of a refused or accepted save (`{ issues | warnings: [{ message }] }`). */
const issueMessages = (value: unknown): string[] => Array.isArray(value)
  ? value.flatMap(entry => isPlainObject(entry) && typeof entry.message === "string" ? [entry.message] : [])
  : [];

const saveSettings = async (
  request: AuthorizedFetch, apiUrl: string, settings: GameSettings
): Promise<SaveSettingsResult> => {
  const response = await request(`${apiUrl}/v1/admin/game-settings`, { method: "PUT", ...jsonBody({ settings }) });
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    const issues = issueMessages(body?.issues);
    return { messages: issues.length ? issues : [String(body?.message ?? response.status)], ok: false };
  }
  const snapshot = { revision: String(body!.revision), settings: body!.settings as GameSettings };
  return { ok: true, snapshot, warnings: issueMessages(body?.warnings) };
};

/** GS1 routes: public read, administrator write and the revision history (footer). */
export const createServerSettingsPort = (backend: BackendConfig, request: AuthorizedFetch): SettingsPort => ({
  latestRevision: async () => {
    const url = `${backend.apiUrl}/v1/admin/game-settings/revisions?limit=${FOOTER_REVISION_LIMIT}`;
    const body = await readJson<{ current: string; revisions: RevisionInfo[] }>(await request(url));
    return body.revisions.find(entry => entry.revision === body.current)
      ?? { createdAt: null, createdBy: null, revision: body.current };
  },
  load: async () => readJson<SettingsSnapshot>(await request(`${backend.apiUrl}/v1/game-settings`)),
  save: settings => saveSettings(request, backend.apiUrl, settings),
  store: "server"
});

/** Identity routes of the Users placeholder (first 100 accounts, ban/unban). */
export const createServerUsersPort = (backend: BackendConfig, request: AuthorizedFetch): UsersPort => ({
  list: async () => {
    const url = `${backend.identityUrl}/v1/admin/accounts?limit=${USER_LIST_LIMIT}`;
    return (await readJson<{ accounts: AdminAccount[] }>(await request(url))).accounts;
  },
  setStatus: async (accountId: string, change: AccountStatusChange) => {
    const url = `${backend.identityUrl}/v1/admin/accounts/${encodeURIComponent(accountId)}/${change}`;
    return (await readJson<{ account: AdminAccount }>(await request(url, { method: "POST" }))).account;
  }
});
