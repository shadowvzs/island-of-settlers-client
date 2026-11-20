import { describe, expect, it, vi } from "vitest";

import { continuesLastGame, isLoginSkipped, startScrollUrl } from "../src/app/account/account-boot";
import { createAccountSession } from "../src/app/account/account-session";
import {
  ACCOUNT_TAKEN, collectRegistrationErrors, createAccountStore, TOO_MANY_ATTEMPTS, WRONG_CREDENTIALS
} from "../src/app/account/account-store";
import { validateDisplayName, validateEmail, validatePassword } from "../src/app/account/account-validation";
import type { IdentityAccount, IdentityClient, IdentityResult } from "../src/app/account/identity-client";

const ACCOUNT: IdentityAccount = { displayName: "Livia", id: "a1", nation: "roman", role: "player" };
const REGISTRATION = { displayName: "Livia", email: "livia@example.test", password: "aqueducts-rule", race: "roman" as const };

/** An identity client answering every call with `result`; records the calls. */
const identity = (result: IdentityResult) => {
  const calls: unknown[] = [];
  return { calls, client: {
    login: async (credentials: unknown) => { calls.push(["login", credentials]); return result; },
    register: async (registration: unknown) => { calls.push(["register", registration]); return result; }
  } as unknown as IdentityClient };
};
const refused = (code: string, status = 400): IdentityResult => ({ code, message: code, ok: false, status });

describe("registration rules (identity service)", () => {
  it("accepts 3-32 letters and digits as display name, a valid email and 10+ character passwords", () => {
    expect(validateDisplayName("Ada")).toBeNull();
    expect(validateDisplayName("Ada Lovelace")).toMatch(/letters and numbers/);
    expect(validateDisplayName("Al")).toMatch(/3-32/);
    expect(validateEmail("ada@example.test")).toBeNull();
    expect(validateEmail("ada@")).toMatch(/valid email/);
    expect(validatePassword("ten chars!")).toBeNull();
    expect(validatePassword("  short   ")).toMatch(/10-128/);
    expect(validatePassword("")).toBe("Enter a password.");
  });

  it("reports every invalid field at once, the nation too", () => {
    expect(Object.keys(collectRegistrationErrors({ displayName: "", email: "x", password: "", race: null })))
      .toEqual(["displayName", "email", "password", "race"]);
  });
});

describe("account store", () => {
  it("registers and signs in through identity with the nation and a trimmed email", async () => {
    const { calls, client } = identity({ account: ACCOUNT, ok: true });
    const store = createAccountStore(client);
    expect(await store.register({ ...REGISTRATION, email: " livia@example.test " })).toEqual({ account: ACCOUNT, ok: true });
    expect(await store.signIn({ email: "livia@example.test", password: "aqueducts-rule" }))
      .toEqual({ account: ACCOUNT, ok: true });
    expect(calls).toEqual([
      ["register", { displayName: "Livia", email: "livia@example.test", nation: "roman", password: "aqueducts-rule" }],
      ["login", { email: "livia@example.test", password: "aqueducts-rule" }]
    ]);
  });

  it("checks the fields before asking identity", async () => {
    const { calls, client } = identity({ account: ACCOUNT, ok: true });
    const result = await createAccountStore(client).signIn({ email: "", password: "" });
    expect(result).toEqual({ errors: { email: "Enter your email address.", password: "Enter your password." }, ok: false });
    expect(calls).toEqual([]);
  });

  it("shows each refusal under its field; an unknown failure is a form error", async () => {
    const answer = async (failure: IdentityResult) =>
      createAccountStore(identity(failure).client).signIn({ email: "a@b.cd", password: "x" });
    expect(await answer(refused("AUTH_INVALID_CREDENTIALS", 401)))
      .toEqual({ errors: { password: WRONG_CREDENTIALS }, ok: false });
    expect(await answer(refused("ACCOUNT_ALREADY_EXISTS", 409))).toEqual({ errors: { email: ACCOUNT_TAKEN }, ok: false });
    expect(await answer(refused("RATE_LIMITED", 429))).toEqual({ errors: { email: TOO_MANY_ATTEMPTS }, ok: false });
    await expect(answer(refused("NETWORK", 0))).rejects.toThrow("NETWORK");
  });
});

describe("log out", () => {
  it("saves first, then stops saving, releases the session lease and ends the identity session", async () => {
    const events: string[] = [];
    const saving = { flush: vi.fn(async () => { events.push("save"); return true; }),
      setPaused: vi.fn(), stop: vi.fn(() => events.push("stop")) };
    const session = createAccountSession({ leave: () => events.push("leave"),
      player: { account: ACCOUNT, identity: { logout: async () => { events.push("logout"); } } } as never,
      releaseSession: async () => { events.push("release"); }, saving });
    expect(session.settings.displayName).toBe("Livia");
    expect(await session.settings.logOut()).toBe(true);
    expect(events).toEqual(["save", "stop", "release", "logout", "leave"]);
    expect(saving.flush).toHaveBeenCalledWith("logout");
  });

  it("switching the save slot saves, ends the slot's session but keeps the sign-in", async () => {
    const events: string[] = [];
    const saving = { flush: vi.fn(async () => true), setPaused: vi.fn(), stop: vi.fn() };
    const session = createAccountSession({ leave: () => events.push("leave"),
      player: { account: ACCOUNT, identity: { logout: async () => { events.push("logout"); } } } as never,
      releaseSession: async () => { events.push("release"); }, saving });
    expect(await session.settings.switchSlot!()).toBe(true);
    expect(events).toEqual(["release", "leave"]);
    expect(createAccountSession({ leave: vi.fn(), player: { account: ACCOUNT } as never, saving }).settings.switchSlot)
      .toBeUndefined();
  });

  it("keeps the player signed in when the save fails", async () => {
    const saving = { flush: vi.fn(async () => false), setPaused: vi.fn(), stop: vi.fn() }, leave = vi.fn();
    const session = createAccountSession({ leave, player: { account: ACCOUNT, identity: {} } as never, saving });
    expect(await session.settings.logOut()).toBe(false);
    expect(saving.setPaused).toHaveBeenLastCalledWith(false);
    expect(leave).not.toHaveBeenCalled();
  });
});

describe("startup rules", () => {
  it("skips registration for tools unless ?login=1", () => {
    expect(isLoginSkipped("?seed=123", true)).toBe(true);
    expect(isLoginSkipped("?login=1", true)).toBe(false);
    expect(isLoginSkipped("", false)).toBe(false);
    expect(isLoginSkipped("?skipLogin=1", false)).toBe(true);
  });
  it("continues the last game only on a plain launch", () => {
    expect(continuesLastGame("")).toBe(true);
    expect(continuesLastGame("?quality=high")).toBe(true);
    expect(continuesLastGame("?seed=5")).toBe(false);
    expect(continuesLastGame("?map=slot")).toBe(false);
    expect(continuesLastGame("?world=1")).toBe(false);
  });
  it("log out returns to the scroll without island parameters", () => {
    expect(startScrollUrl("http://localhost:5173/?seed=5&login=1&map=x"))
      .toBe("http://localhost:5173/?login=1");
  });
});
