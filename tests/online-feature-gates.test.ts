import { createElement, createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { detectBackend } from "../src/app/backend/backend-status";
import { ALL_ONLINE_FEATURES } from "../src/app/backend/constants";
import {
  guardedByOnlineFeature, isOnlineFeatureEnabled, onlineFeatures, publishOnlineFeatures, readOnlineFeatures
} from "../src/app/backend/online-features";
import { getMenuEntries } from "../src/app/settlement-ui/main-panel/helpers";
import { MenuView } from "../src/app/settlement-ui/main-panel/menu-view";
import { selectPlayerHud } from "../src/app/settlement-ui/player-hud/helpers";
import { PlayerHud, PlayerHudView } from "../src/app/settlement-ui/player-hud/player-hud";
import type { SettlementPlayerSummary } from "../src/app/settlement-ui/types";
import { createSettlementUiStore } from "../src/app/settlement-ui/ui-store";
import { renderWithI18n } from "./helpers/render-with-i18n";

const ENV = { VITE_API_URL: "https://api.example.test", VITE_IDENTITY_URL: "https://id.example.test" };
const player: SettlementPlayerSummary = {
  current: 40, experience: 140, fraction: 0.4, gems: 1250, level: 2, nation: "roman", needed: 100, quests: [],
  stock: {}, talents: {}
};
const noop = () => undefined;

/** A ready backend whose `/config` publishes `features`. */
const backendWith = (features: Record<string, unknown>) => vi.fn(async (url: string) =>
  new Response(JSON.stringify(url.endsWith("/config") ? { apiVersion: "1", features } : { status: "ok" }))
) as unknown as typeof fetch;

const without = (...keys: (keyof typeof ALL_ONLINE_FEATURES)[]) => {
  const features = { ...ALL_ONLINE_FEATURES };
  for (const key of keys) features[key] = false;
  return features;
};

afterEach(() => {
  publishOnlineFeatures(ALL_ONLINE_FEATURES);
  vi.unstubAllGlobals();
});

describe("online features from /config", () => {
  it("reads the five switches (the market is `trades`); only an explicit false switches one off", () => {
    expect(readOnlineFeatures({ features: { accounts: true, cloudSaves: true } })).toEqual(ALL_ONLINE_FEATURES);
    expect(readOnlineFeatures({ features: { chat: false, friends: false, guilds: true, shop: false, trades: false } }))
      .toEqual({ chat: false, friends: false, guilds: true, market: false, shop: false });
    expect(readOnlineFeatures({ features: { market: false, trades: "no" } })).toEqual(ALL_ONLINE_FEATURES);
    for (const body of [null, "config", {}, { features: [] }])
      expect(readOnlineFeatures(body)).toEqual(ALL_ONLINE_FEATURES);
  });

  it("startup detection publishes the server's switches; standalone play keeps today's set", async () => {
    const listener = vi.fn();
    const unsubscribe = onlineFeatures.subscribe(listener);
    await detectBackend(ENV, { fetch: backendWith({ shop: false, trades: false }) });
    expect(onlineFeatures.getSnapshot()).toEqual(without("market", "shop"));
    expect(isOnlineFeatureEnabled("market")).toBe(false);
    expect(isOnlineFeatureEnabled("chat")).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    // An equal answer publishes nothing (no view re-renders).
    await detectBackend(ENV, { fetch: backendWith({ shop: false, trades: false }) });
    expect(listener).toHaveBeenCalledTimes(1);
    await detectBackend({}, { fetch: backendWith({}) });
    expect(onlineFeatures.getSnapshot()).toEqual(ALL_ONLINE_FEATURES);
    unsubscribe();
  });
});

describe("market entry", () => {
  it("is in the Main selection by default and gone while the market is off", () => {
    expect(getMenuEntries(undefined, ALL_ONLINE_FEATURES).map(entry => entry.id))
      .toEqual(["buildings", "overview", "ships", "market", "settings"]);
    expect(getMenuEntries(undefined, without("market")).map(entry => entry.id))
      .toEqual(["buildings", "overview", "ships", "settings"]);
    expect(getMenuEntries(undefined, without("chat", "friends", "guilds", "shop"))).toHaveLength(5);
  });

  it("the menu view follows the published switches", () => {
    const menu = () => renderWithI18n(createElement(MenuView, { onMenuEntry: noop, shortcuts: [] }));
    expect(menu()).toContain('data-ui-anchor="menu.market"');
    publishOnlineFeatures(without("market"));
    expect(menu()).not.toContain("menu.market");
    expect(menu()).toContain('data-ui-anchor="menu.settings"');
  });
});

describe("gem shop entry", () => {
  const hudProps = (shopOffered?: boolean) => ({
    className: "player-hud", model: selectPlayerHud({ player })!, portraitHidden: false,
    portraitRef: createRef<HTMLButtonElement>(), portraitStyle: {}, shopOffered,
    toggle: { label: "Hide portrait", title: "Level 2" },
    onOpenMessages: noop, onOpenQuests: noop, onOpenShop: noop, onOpenTalents: noop, onTogglePortrait: noop
  });

  it("is the gem counter button by default", () => {
    const markup = renderWithI18n(createElement(PlayerHudView, hudProps()));
    expect(markup).toMatch(/<button[^>]*class="player-hud__gems"[^>]*data-ui-anchor="hud\.gemShop"/);
    expect(markup).not.toContain("player-hud__gems--readonly");
  });

  it("is gone while the shop is off: the gem count stays as a read-only chip", () => {
    const markup = renderWithI18n(createElement(PlayerHudView, hudProps(false)));
    expect(markup).not.toContain("hud.gemShop");
    expect(markup)
      .toMatch(/<span[^>]*class="player-hud__gems player-hud__gems--readonly"[^>]*>.*<b>1,250<\/b><\/span>/);
  });

  it("the connected corner follows the published switches", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    const store = createSettlementUiStore();
    store.update({ player });
    const corner = () => renderWithI18n(createElement(PlayerHud, {
      store, onOpenMessages: noop, onOpenQuests: noop, onOpenShop: noop, onOpenTalents: noop
    }));
    expect(corner()).toContain("hud.gemShop");
    publishOnlineFeatures(without("shop"));
    expect(corner()).not.toContain("hud.gemShop");
  });
});

describe("feature-guarded windows", () => {
  it("open only while their feature is on and keep every other action", () => {
    const open = vi.fn(), close = vi.fn();
    const market = guardedByOnlineFeature("market", { close, open });
    market.open();
    expect(open).toHaveBeenCalledTimes(1);
    publishOnlineFeatures(without("market"));
    market.open();
    market.close();
    expect(open).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    publishOnlineFeatures(ALL_ONLINE_FEATURES);
    market.open();
    expect(open).toHaveBeenCalledTimes(2);
  });
});
