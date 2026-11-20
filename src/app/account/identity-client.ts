import type { PlayerAvatarGender } from "../../render-common/workers/player-avatar";
import type { WorkerNation } from "../../render-common/workers/worker-unit";

/** The public account fields identity returns (never the email or a password hash). */
export interface IdentityAccount {
  /** Optional: old accounts have no stored choice and default to their nation's canonical portrait. */
  avatarGender?: PlayerAvatarGender;
  displayName: string;
  id: string;
  nation: WorkerNation;
  role: string;
}

export interface IdentityRegistration {
  displayName: string;
  email: string;
  nation: WorkerNation;
  password: string;
}

export interface IdentityCredentials {
  email: string;
  password: string;
}

export type IdentityResult =
  | { account: IdentityAccount; ok: true }
  | { code: string; message: string; ok: false; status: number };

/** No usable session: the refresh cookie is gone, revoked or expired (sign in again). */
export class SignedOutError extends Error {
  constructor() {
    super("Your session ended. Sign in again to keep saving online.");
    this.name = "SignedOutError";
  }
}

export interface IdentityClientOptions {
  fetch?: typeof fetch;
  identityUrl: string;
  /** Serializes refreshes across this browser's tabs (Web Locks); the default uses `navigator.locks`. */
  lock?: <T>(run: () => Promise<T>) => Promise<T>;
  now?: () => number;
}

interface SessionBody {
  accessToken: string;
  account: IdentityAccount;
}

const REFRESH_LOCK = "island-settlers-identity-refresh";
/** An access token is renewed when it has less than this left (identity issues 15 minutes). */
const RENEW_BEFORE_MS = 60_000;
const NETWORK_ERROR = { code: "NETWORK", message: "The account service cannot be reached. Try again soon.", ok: false,
  status: 0 } as const;

/** Seconds-since-epoch `exp` of a JWT, in milliseconds (0 when unreadable: renew at once). */
export const tokenExpiry = (token: string) => {
  try {
    const payload = token.split(".")[1] ?? "";
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp === "number" ? exp * 1000 : 0;
  } catch {
    return 0;
  }
};

const browserLock = <T>(run: () => Promise<T>) => {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  return locks ? locks.request(REFRESH_LOCK, run) as Promise<T> : run();
};

const readFailure = async (response: Response): Promise<IdentityResult> => {
  const body = await response.json().catch(() => ({})) as { code?: string; message?: string };
  return { code: body.code ?? "REQUEST_FAILED", message: body.message ?? `Request failed (${response.status})`,
    ok: false, status: response.status };
};

/**
 * The identity service in the browser (docs/server/identity.md): the access token lives only in memory; the
 * refresh token is the service's HttpOnly cookie, sent with `credentials: "include"`. Refreshes run one at a
 * time across tabs (a reused refresh token would revoke the whole session family).
 */
export const createIdentityClient = ({
  fetch: request = fetch, identityUrl, lock = browserLock, now = Date.now
}: IdentityClientOptions) => {
  let accessToken: string | null = null, expiresAt = 0, account: IdentityAccount | null = null;
  let refreshing: Promise<IdentityAccount | null> | null = null;
  const send = (method: "PATCH" | "POST", path: string, body?: unknown, bearer?: string) => {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (bearer) headers.Authorization = `Bearer ${bearer}`;
    return request(`${identityUrl}${path}`, { body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store", credentials: "include", headers, method });
  };
  const post = (path: string, body?: unknown, bearer?: string) => send("POST", path, body, bearer);
  const accept = async (response: Response) => {
    const body = await response.json() as SessionBody;
    accessToken = body.accessToken;
    expiresAt = tokenExpiry(body.accessToken);
    account = body.account;
    return body.account;
  };
  const forget = () => {
    accessToken = null;
    expiresAt = 0;
    account = null;
  };
  const signIn = async (path: string, body: unknown): Promise<IdentityResult> => {
    let response: Response;
    try { response = await post(path, body); } catch { return NETWORK_ERROR; }
    if (!response.ok) return readFailure(response);
    return { account: await accept(response), ok: true };
  };
  const runRefresh = () => lock(async () => {
    const response = await post("/v1/auth/refresh");
    if (response.ok) return accept(response);
    if (response.status === 401 || response.status === 403) forget();
    if (response.status >= 500 || response.status === 429) throw new Error("The account service is unavailable");
    return null;
  });
  /** A new access token from the refresh cookie; null when there is no session (signed out). */
  const refresh = () => {
    refreshing ??= runRefresh().finally(() => { refreshing = null; });
    return refreshing;
  };
  /** A current access token, renewed shortly before it expires; SignedOutError without a session. */
  const sessionAccessToken = async () => {
    if (accessToken && expiresAt - now() > RENEW_BEFORE_MS) return accessToken;
    await refresh();
    if (!accessToken) throw new SignedOutError();
    return accessToken;
  };
  /** Stores the account's avatar gender and replaces the cached account with the returned one. */
  const setAvatarGender = async (avatarGender: PlayerAvatarGender): Promise<IdentityResult> => {
    let bearer: string;
    try {
      bearer = await sessionAccessToken();
    } catch {
      return { code: "AUTH_REQUIRED", message: "Sign in again to save avatar choices.", ok: false, status: 401 };
    }
    let response: Response;
    try {
      response = await send("PATCH", "/v1/account/avatar", { avatarGender }, bearer);
    } catch {
      return NETWORK_ERROR;
    }
    if (!response.ok) return readFailure(response);
    const body = await response.json() as { account: IdentityAccount };
    account = body.account;
    return { account: body.account, ok: true };
  };
  return {
    account: () => account,
    /** A current access token, renewed shortly before it expires; SignedOutError without a session. */
    accessToken: sessionAccessToken,
    login: (credentials: IdentityCredentials) => signIn("/v1/auth/login", credentials),
    /** Ends this device's session (the cookie is cleared); the token is forgotten even when offline. */
    logout: async () => {
      const token = accessToken;
      forget();
      if (token) await post("/v1/auth/logout", undefined, token).catch(() => undefined);
    },
    /** The account of a token rejected by a service (401): renew once before giving up. */
    renew: async () => {
      expiresAt = 0;
      return refresh();
    },
    register: (registration: IdentityRegistration) => signIn("/v1/auth/register", registration),
    /** Signs the remembered session in silently (refresh cookie); null without one or when unreachable. */
    resume: () => refresh().catch(() => null),
    /** Saves the player's male/female avatar choice to the account profile. */
    setAvatarGender
  };
};

export type IdentityClient = ReturnType<typeof createIdentityClient>;
