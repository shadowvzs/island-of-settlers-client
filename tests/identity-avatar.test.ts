import { describe, expect, it, vi } from "vitest";

import { isAccountAvatarGender } from "../../island-of-settlers-shared/src/validation";
import { createIdentityClient } from "../src/app/account/identity-client";

const account = {
  displayName: "Ragnar",
  id: "0e5cfa9d-3e56-4a4b-9a61-b3e3bd43d7d0",
  nation: "roman" as const,
  role: "player"
};

const token = () => {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }))
    .toString("base64url");
  return `header.${payload}.signature`;
};

const requestUrl = (input: string | URL | Request) => {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
};

const identityFetch = () => {
  const accessToken = token();
  const calls: { body?: string; headers?: HeadersInit; method?: string; url: string }[] = [];
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = requestUrl(input);
    const body = typeof init?.body === "string" ? init.body : undefined;
    calls.push({ body, headers: init?.headers, method: init?.method, url });
    if (url.endsWith("/v1/auth/login"))
      return new Response(JSON.stringify({ accessToken, account }), { status: 200 });
    if (url.endsWith("/v1/account/avatar"))
      return new Response(JSON.stringify({ account: { ...account, avatarGender: "female" } }), { status: 200 });
    throw new Error(`Unexpected identity request: ${url}`);
  });
  return { calls, client: createIdentityClient({
    fetch: fetch as typeof globalThis.fetch,
    identityUrl: "http://identity.test",
    lock: run => run()
  }) };
};

describe("identity avatar persistence", () => {
  it("patches the account profile with the selected avatar gender and caches the result", async () => {
    const { calls, client } = identityFetch();
    const signedIn = await client.login({ email: "ragnar@example.test", password: "password" });
    expect(signedIn.ok).toBe(true);
    const saved = await client.setAvatarGender("female");
    expect(saved.ok).toBe(true);
    expect(client.account()).toMatchObject({ avatarGender: "female" });
    const patch = calls.find(call => call.method === "PATCH");
    expect(patch?.url).toBe("http://identity.test/v1/account/avatar");
    expect(JSON.parse(patch?.body ?? "{}")).toEqual({ avatarGender: "female" });
    const headers = (patch?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toMatch(/^Bearer header\./);
  });

  it("validates the optional field shared by the identity and API services", () => {
    expect(isAccountAvatarGender("female")).toBe(true);
    expect(isAccountAvatarGender("male")).toBe(true);
    expect(isAccountAvatarGender("woman")).toBe(false);
    expect(isAccountAvatarGender(undefined)).toBe(false);
  });
});
