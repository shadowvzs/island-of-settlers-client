import type { BrowserContext, Page } from "playwright-core";

/**
 * A stand-in backend for browser tests of online-only UI (the account scroll). Dev servers started for tests
 * configure the backend at these same-origin paths; nothing serves them, so the game probes, finds no backend
 * and stays standalone, exactly as a player without a reachable server. A page that routes them healthy
 * (`routeHealthyBackend`) starts with `backendAvailable`.
 */
const TEST_BACKEND = "/__test-backend";

export const TEST_BACKEND_ENV = {
  VITE_API_URL: `${TEST_BACKEND}/api`,
  VITE_IDENTITY_URL: `${TEST_BACKEND}/identity`
} as const;

const RUNTIME_CONFIG = { apiVersion: "1", features: { accounts: true, cloudSaves: true } };

/**
 * Answers the save API's startup probe (`GET /config` and `/ready`) as a ready backend, and identity's silent
 * sign-in as "no session" (so the start scroll opens).
 */
export const routeHealthyBackend = async (target: BrowserContext | Page) => {
  await target.route(`**${TEST_BACKEND_ENV.VITE_API_URL}/{config,ready}`, route => route.fulfill({
    json: route.request().url().endsWith("/config") ? RUNTIME_CONFIG : { status: "ok" }
  }));
  await target.route(`**${TEST_BACKEND_ENV.VITE_IDENTITY_URL}/v1/auth/refresh`, route => route.fulfill({
    json: { code: "AUTH_REQUIRED", message: "No session", requestId: "test" }, status: 401
  }));
};
