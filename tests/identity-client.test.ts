import { describe, expect, it, vi } from "vitest";

import { createIdentityClient, SignedOutError, tokenExpiry } from "../src/app/account/identity-client";

const IDENTITY = "http://127.0.0.1:3001";
const ACCOUNT = { displayName: "Livia", id: "a1", nation: "roman", role: "player" };

/** An unsigned JWT-shaped token expiring at `exp` (seconds). */
const token = (exp: number, name = "t") =>
  `h.${btoa(JSON.stringify({ exp, name })).replace(/=+$/, "")}.s`;

interface Call { body?: unknown; credentials?: RequestCredentials; headers: Record<string, string>; path: string }

const identity = (answer: (path: string, call: Call) => Response, now = () => 1_000_000) => {
  const calls: Call[] = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const call = { body: init.body && JSON.parse(init.body as string), credentials: init.credentials,
      headers: init.headers as Record<string, string>, path: url.slice(IDENTITY.length) };
    calls.push(call);
    return answer(call.path, call);
  }) as unknown as typeof globalThis.fetch;
  return { calls, client: createIdentityClient({ fetch, identityUrl: IDENTITY, lock: run => run(), now }) };
};

const session = (exp: number, name?: string) =>
  Response.json({ accessToken: token(exp, name), account: ACCOUNT });

describe("identity client", () => {
  it("reads the token expiry and treats unreadable tokens as expired", () => {
    expect(tokenExpiry(token(2000))).toBe(2_000_000);
    expect(tokenExpiry("garbage")).toBe(0);
  });

  it("signs in with the refresh cookie and keeps the access token only in memory", async () => {
    const { calls, client } = identity(() => session(5000));
    expect(await client.login({ email: "l@x.yz", password: "secret-pass" })).toEqual({ account: ACCOUNT, ok: true });
    expect(calls[0]).toMatchObject({ body: { email: "l@x.yz", password: "secret-pass" }, credentials: "include",
      path: "/v1/auth/login" });
    expect(await client.accessToken()).toBe(token(5000));
    expect(calls).toHaveLength(1);
    expect(client.account()).toEqual(ACCOUNT);
  });

  it("renews a token about to expire, one refresh at a time", async () => {
    let refreshes = 0;
    const { calls, client } = identity(path => {
      if (path === "/v1/auth/refresh") return session(5000, `r${++refreshes}`);
      return session(1030);
    });
    await client.login({ email: "l@x.yz", password: "secret-pass" });
    const [first, second] = await Promise.all([client.accessToken(), client.accessToken()]);
    expect(first).toBe(second);
    expect(calls.map(call => call.path)).toEqual(["/v1/auth/login", "/v1/auth/refresh"]);
    expect(calls[1]!.credentials).toBe("include");
  });

  it("resumes a remembered session, or none without a cookie", async () => {
    expect(await identity(() => session(5000)).client.resume()).toEqual(ACCOUNT);
    const signedOut = identity(() => new Response(null, { status: 401 })).client;
    expect(await signedOut.resume()).toBeNull();
    await expect(signedOut.accessToken()).rejects.toBeInstanceOf(SignedOutError);
    expect(await identity(() => { throw new TypeError("offline"); }).client.resume()).toBeNull();
  });

  it("reports refusals and network failures without throwing", async () => {
    const refused = identity(() => Response.json({ code: "AUTH_INVALID_CREDENTIALS", message: "Invalid" },
      { status: 401 })).client;
    expect(await refused.login({ email: "a@b.cd", password: "x" }))
      .toEqual({ code: "AUTH_INVALID_CREDENTIALS", message: "Invalid", ok: false, status: 401 });
    const offline = identity(() => { throw new TypeError("offline"); }).client;
    expect(await offline.register({ displayName: "Ada", email: "a@b.cd", nation: "roman", password: "0123456789" }))
      .toMatchObject({ code: "NETWORK", ok: false, status: 0 });
  });

  it("logs out with the bearer token and forgets the session even offline", async () => {
    const { calls, client } = identity(path => (path === "/v1/auth/logout" ? new Response(null, { status: 204 })
      : session(5000)));
    await client.login({ email: "l@x.yz", password: "secret-pass" });
    await client.logout();
    expect(calls[1]).toMatchObject({ headers: { Authorization: `Bearer ${token(5000)}` }, path: "/v1/auth/logout" });
    expect(client.account()).toBeNull();
  });
});
