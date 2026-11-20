import { afterEach, describe, expect, it, vi } from "vitest";

import { startPlayer } from "../src/app/account/account-boot";
import { readBackendConfig } from "../src/app/backend/backend-config";
import { backendStatus, detectBackend } from "../src/app/backend/backend-status";

const ENV = { VITE_API_URL: "https://api.example.test/", VITE_IDENTITY_URL: "https://id.example.test" };
const CONFIG = { apiVersion: "1", features: { accounts: true, cloudSaves: true } };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** A backend answering `/config` and `/ready` (each overridable). */
const backend = (answers: { config?: () => Response; ready?: () => Response } = {}) =>
  vi.fn(async (url: string) => {
    if (url.endsWith("/config")) return answers.config?.() ?? json(CONFIG);
    return answers.ready?.() ?? json({ status: "ok" });
  }) as unknown as typeof fetch;

/** A fetch that never answers until its signal aborts (an unreachable host). */
const hanging = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
  init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
})) as unknown as typeof fetch;

afterEach(() => { vi.unstubAllEnvs(); });

describe("backend config", () => {
  it("needs both service URLs and drops trailing slashes", () => {
    expect(readBackendConfig({})).toBeNull();
    expect(readBackendConfig({ VITE_API_URL: ENV.VITE_API_URL })).toBeNull();
    expect(readBackendConfig({ VITE_API_URL: " ", VITE_IDENTITY_URL: ENV.VITE_IDENTITY_URL })).toBeNull();
    expect(readBackendConfig(ENV))
      .toEqual({ apiUrl: "https://api.example.test", identityUrl: "https://id.example.test" });
  });
});

describe("backend detection", () => {
  it("is standalone without configuration and sends no request", async () => {
    const fetch = backend();
    expect(await detectBackend({}, { fetch })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(backendStatus.getSnapshot()).toBe(false);
  });

  it("is standalone when the configured backend is unreachable, slow or not ready", async () => {
    const offline = vi.fn(async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch;
    expect(await detectBackend(ENV, { fetch: offline })).toBeNull();
    expect(await detectBackend(ENV, { fetch: hanging, timeoutMs: 20 })).toBeNull();
    expect(await detectBackend(ENV, { fetch: backend({ ready: () => json({}, 503) }) })).toBeNull();
    expect(await detectBackend(ENV, { fetch: backend({ config: () => new Response("<html>") }) })).toBeNull();
    expect(backendStatus.getSnapshot()).toBe(false);
  });

  it("is available when the backend serves its config and reports ready", async () => {
    const fetch = backend();
    expect(await detectBackend(ENV, { fetch })).toEqual(readBackendConfig(ENV));
    expect(backendStatus.getSnapshot()).toBe(true);
    const urls = vi.mocked(fetch).mock.calls.map(([url]) => url as string).sort();
    expect(urls).toEqual(["https://api.example.test/config", "https://api.example.test/ready"]);
    await detectBackend({}, { fetch });
    expect(backendStatus.getSnapshot()).toBe(false);
  });
});

describe("standalone start", () => {
  it("plays as guest without any login UI when no backend is configured", async () => {
    vi.stubEnv("VITE_API_URL", "");
    vi.stubEnv("VITE_IDENTITY_URL", "");
    const setRegistering = vi.fn();
    const player = await startPlayer({ automated: false, container: {} as HTMLElement, search: "", setRegistering });
    expect(player).toEqual({ account: null, backend: null, cloud: null, toolRun: false });
    expect(setRegistering).not.toHaveBeenCalled();
  });

  it("signs in without a cloud slot or lease in offline mode (OFFLINE-CLOUD)", async () => {
    const account = { displayName: "Ana", id: "account-1", nation: "roman", role: "player" };
    const fetch = vi.fn(async (url: string) => url.endsWith("/v1/auth/refresh")
      ? json({ accessToken: "header.e30.signature", account })
      : json({ code: "UNEXPECTED" }, 500));
    vi.stubGlobal("fetch", fetch);
    const backend = readBackendConfig(ENV)!, setRegistering = vi.fn();
    const player = await startPlayer({ automated: false, backend, container: {} as HTMLElement, offline: true,
      search: "", setRegistering });
    expect(player.account?.account).toEqual(account);
    expect(player.cloud).toBeNull();
    // Only the remembered session's refresh: no save slot, lease or cloud request.
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([`${ENV.VITE_IDENTITY_URL}/v1/auth/refresh`]);
    expect(setRegistering).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("keeps tool runs fresh (no account, no continued save)", async () => {
    const player = await startPlayer({ automated: true, container: {} as HTMLElement, search: "",
      setRegistering: () => {} });
    expect(player).toEqual({ account: null, backend: null, cloud: null, toolRun: true });
  });
});
