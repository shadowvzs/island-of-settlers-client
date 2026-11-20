import { readFileSync } from "node:fs";
import { createElement, createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createIdleExplorationSnapshot, type ExplorationUiSnapshot } from "../src/app/exploration/contracts";
import { ExplorationEntryButton } from "../src/app/exploration/ui/entry-button";
import { attachExplorationEntry } from "../src/app/exploration/ui/entry-store";
import { ExplorationView } from "../src/app/exploration/ui/exploration-view";
import {
  explorationRefusalNotice,
  isExplorationEntryVisible,
  selectExplorationEntryView,
  selectExplorationOverlayView
} from "../src/app/exploration/ui/view-model";
import { hotkeySettings } from "../src/app/settings/hotkeys/bindings";
import { getPlayerHudClassName, selectPlayerHud } from "../src/app/settlement-ui/player-hud/helpers";
import { PlayerHudView } from "../src/app/settlement-ui/player-hud/player-hud";
import type { SettlementPlayerSummary } from "../src/app/settlement-ui/types";
import { renderWithI18n } from "./helpers/render-with-i18n";

const player: SettlementPlayerSummary = {
  current: 40,
  experience: 140,
  fraction: 0.4,
  gems: 1250,
  level: 2,
  nation: "roman",
  needed: 100,
  quests: [],
  stock: {},
  talents: {}
};

const homeSnapshot = (changes: Partial<ExplorationUiSnapshot> = {}): ExplorationUiSnapshot => ({
  ...createIdleExplorationSnapshot({ eligible: true }),
  canEnter: true,
  ...changes
});

const cleanup: (() => void)[] = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});

const attachEntry = (snapshot: ExplorationUiSnapshot | null, onEnter = vi.fn()) => {
  cleanup.push(attachExplorationEntry({ onEnter, snapshot }));
  return onEnter;
};

const hudProps = (className: string, portraitHidden = false) => ({
  className,
  model: selectPlayerHud({ player })!,
  portraitHidden,
  portraitRef: createRef<HTMLButtonElement>(),
  portraitStyle: {},
  toggle: portraitHidden
    ? { label: "Show portrait", title: "Level 2 · click to show the portrait" }
    : { label: "Hide portrait", title: "Level 2 · click to hide the portrait" },
  onOpenMessages: vi.fn(),
  onOpenQuests: vi.fn(),
  onOpenShop: vi.fn(),
  onOpenTalents: vi.fn(),
  onTogglePortrait: vi.fn()
});

const entryMarkup = (snapshot: ExplorationUiSnapshot) => {
  const view = selectExplorationEntryView(snapshot)!;
  return renderWithI18n(createElement(ExplorationEntryButton, { view, onClick: vi.fn() }));
};

describe("exploration entry affordance", () => {
  it("prepares idle, preparing, active, cooldown and blocked states", () => {
    expect(selectExplorationEntryView(homeSnapshot())).toMatchObject({
      ariaLabel: "Explore home island",
      badge: "",
      className: "player-hud__exploration is-idle",
      disabled: false,
      title: "Walk the home island as your portrait explorer"
    });
    expect(selectExplorationEntryView(homeSnapshot({ phase: "preparing", canEnter: false }))).toMatchObject({
      ariaLabel: "Preparing explorer",
      className: "player-hud__exploration is-preparing",
      disabled: true
    });
    expect(selectExplorationEntryView(homeSnapshot({ phase: "returning", canEnter: false }))).toMatchObject({
      ariaLabel: "Exploration active",
      className: "player-hud__exploration is-active",
      disabled: true
    });
    expect(selectExplorationEntryView(homeSnapshot({ cooldownInMs: 2_400, phase: "cooldown" }))).toMatchObject({
      ariaLabel: "Explore again in 3 seconds",
      badge: "3s",
      className: "player-hud__exploration is-cooldown",
      disabled: true
    });
    expect(selectExplorationEntryView(homeSnapshot({ canEnter: false }))).toMatchObject({
      ariaLabel: "Exploration unavailable",
      className: "player-hud__exploration is-blocked"
    });
    expect(selectExplorationEntryView(null)).toBeNull();
    expect(selectExplorationEntryView(homeSnapshot({
      eligibility: { eligible: false, reason: "not-home" }
    }))).toBeNull();
    expect(isExplorationEntryVisible(homeSnapshot())).toBe(true);
    expect(isExplorationEntryVisible(null)).toBe(false);
  });

  it("renders a 48 px target with accessible labels, countdown badge and disabled state", () => {
    const idle = entryMarkup(homeSnapshot());
    expect(idle).toContain('<button aria-label="Explore home island" class="player-hud__exploration is-idle"');
    expect(idle).toContain('title="Walk the home island as your portrait explorer"');
    expect(idle).not.toContain("disabled");
    expect(idle).toContain('class="settlement-art-icon"');

    const cooldown = entryMarkup(homeSnapshot({ cooldownInMs: 3_200, phase: "cooldown" }));
    expect(cooldown).toContain('disabled=""');
    expect(cooldown).toContain('aria-label="Explore again in 4 seconds"');
    expect(cooldown).toContain('<span aria-hidden="true" class="player-hud__exploration-badge">4s</span>');
  });

  it("renders as a portrait sibling and keeps its row when the portrait is hidden", () => {
    const onEnter = attachEntry(homeSnapshot());
    const visible = renderWithI18n(createElement(PlayerHudView, hudProps("player-hud has-exploration-entry")));
    const portraitStart = visible.indexOf('<button aria-label="Open daily quests" class="player-hud__portrait"');
    const portraitEnd = visible.indexOf("</button>", portraitStart);
    const entryStart = visible.indexOf('<button aria-label="Explore home island"');
    expect(portraitStart).toBeGreaterThanOrEqual(0);
    expect(entryStart).toBeGreaterThan(portraitEnd);
    expect(visible).toContain("player-hud__level");
    const entryBlock = visible.slice(entryStart, visible.indexOf("</button>", entryStart));
    expect(entryBlock).not.toContain("player-hud__level");
    expect(entryBlock).toContain('title="Walk the home island as your portrait explorer"');

    const hidden = renderWithI18n(createElement(PlayerHudView, hudProps(
      "player-hud is-portrait-hidden has-exploration-entry",
      true
    )));
    expect(hidden).toContain('<aside aria-label="Player" class="player-hud is-portrait-hidden has-exploration-entry">');
    expect(hidden).toContain('aria-label="Explore home island"');
    expect(hidden).toContain('aria-label="Show portrait" aria-pressed="true" class="player-hud__experience"');
    expect(onEnter).not.toHaveBeenCalled();
  });

  it("does not add the entry or extra row when the feature is absent", () => {
    const markup = renderWithI18n(createElement(PlayerHudView, hudProps("player-hud")));
    expect(markup).not.toContain("player-hud__exploration");
    expect(getPlayerHudClassName(false)).toBe("player-hud");
    expect(getPlayerHudClassName(true, true)).toBe("player-hud is-portrait-hidden has-exploration-entry");
  });
});

describe("exploration active HUD", () => {
  it.each(["Soldier","commander","unrecognized-actor"])("hides disabled actions for %s while retaining emergency exit",actorType=>{
    const view=selectExplorationOverlayView(homeSnapshot({ actorType, phase:"possessed",leaveUnlockInMs:0,spyglass:true }))!;
    const markup=renderWithI18n(createElement(ExplorationView,{ input:null,view,onLeave:vi.fn(),onSpyglass:vi.fn() }));
    expect(markup).not.toContain('data-exploration-control="spyglass"');
    expect(markup).not.toContain('class="exploration-ui__spyglass-mask"');
    expect(markup).not.toContain('class="exploration-ui__spyglass-zoom"');
    expect(markup).not.toContain('<kbd>Space</kbd>');
    expect(markup).toContain('<kbd>Esc</kbd>');
    expect(markup).toContain('data-exploration-control="leave"');
    if (actorType === "unrecognized-actor") {
      expect(view.showJoystick).toBe(false);
      expect(view.showLook).toBe(false);
      expect(markup).toMatch(/data-exploration-control="joystick"[^>]*hidden=""/);
      expect(markup).toMatch(/data-exploration-control="look"[^>]*hidden=""/);
      expect(markup).not.toContain('<kbd>↑</kbd>');
    }
  });
  it("renders current possessed bindings including Jump and retains emergency Escape",()=>{
    hotkeySettings.rebind("forward","KeyW");
    hotkeySettings.rebind("possessedJump","KeyJ");
    // KeyQ belongs to the commander guard (`block`) in possessed mode, so Leave cannot take it.
    expect(hotkeySettings.rebind("back","KeyQ")).toEqual({ action:"block",kind:"conflict" });
    expect(hotkeySettings.rebind("back","KeyB")).toEqual({ kind:"accepted" });
    try {
      const view=selectExplorationOverlayView(homeSnapshot({ phase:"possessed",leaveUnlockInMs:0 }))!;
      const markup=renderWithI18n(createElement(ExplorationView,{ input:null,view,onLeave:vi.fn(),onSpyglass:vi.fn() }));
      expect(markup).toContain('<kbd>W</kbd>');
      expect(markup).toContain('<kbd>J</kbd><span>Scout jump</span>');
      expect(markup).toContain('<kbd>B</kbd><kbd>Esc</kbd>');
      expect(markup).not.toContain('<kbd>↑</kbd>');
    } finally { hotkeySettings.reset(); }
  });
  it("renders right-side spyglass and Leave plus the left joystick and look region", () => {
    const view = selectExplorationOverlayView(homeSnapshot({
      canEnter: false,
      leaveUnlockInMs: 0,
      phase: "possessed",
      progress: 1,
      spyglass: true,
      spyglassZoom: 2.5
    }))!;
    const markup = renderWithI18n(createElement(ExplorationView, {
      input: null,
      view,
      onLeave: vi.fn(),
      onSpyglass: vi.fn()
    }));
    expect(markup).toContain('aria-label="Exploration controls" class="exploration-ui__actions"');
    expect(markup).toContain('aria-label="Spyglass" aria-pressed="true" class="exploration-ui__action exploration-ui__spyglass"');
    expect(markup).toContain('class="exploration-ui__action exploration-ui__leave"');
    expect(markup).toContain(">Leave</span>");
    expect(markup).toContain('aria-label="Move" class="exploration-ui__joystick"');
    expect(markup).toContain('class="exploration-ui__keys"');
    expect(markup).toContain('class="exploration-ui__spyglass-mask"');
    for (const key of ["W", "A", "S", "D"]) expect(markup).not.toContain(`<kbd>${key}</kbd>`);
    expect(markup).toContain("<kbd>↑</kbd>");
    expect(markup).toContain("<kbd>Z</kbd>");
    expect(markup).toContain('aria-label="Spyglass zoom" class="exploration-ui__spyglass-zoom"');
    expect(markup).toContain('aria-label="Zoom spyglass out"');
    expect(markup).toContain('aria-label="Zoom spyglass in"');
    expect(markup).toContain(">2.5×</output>");
    expect(markup).toContain("<kbd>+ / =</kbd><kbd>−</kbd><span>Spyglass zoom</span>");
    expect(markup).toContain("<kbd>F</kbd><span>Fullscreen</span>");
    expect(markup).toContain("<kbd>Esc</kbd><span>Spyglass</span>");
    expect(markup).toContain('aria-label="Look around" class="exploration-ui__look"');
    expect(markup).toContain('aria-label="Look stick" class="exploration-ui__look-stick"');
    expect(markup).toContain('title="Drag the look stick to turn and look up or down"');
    expect(markup).toContain('data-spyglass="true"');
    expect(markup).not.toContain("exploration-ui__progress");
    expect(markup).not.toContain("exploration-ui__notice");
  });

  it("shows countdowns while entering without a progress bar", () => {
    const view = selectExplorationOverlayView(homeSnapshot({
      canEnter: false,
      leaveUnlockInMs: 2_000,
      phase: "entering",
      progress: 0.42
    }))!;
    const markup = renderWithI18n(createElement(ExplorationView, {
      reducedMotion: true,
      input: null,
      view,
      onLeave: vi.fn(),
      onSpyglass: vi.fn()
    }));
    expect(markup).toContain('class="exploration-ui is-reduced-motion"');
    expect(markup).not.toContain("Entering the home island…");
    expect(markup).not.toContain("exploration-ui__progress");
    expect(markup).not.toContain("progressbar");
    expect(markup).toContain('title="Leave unlocks in 2 seconds"');
    expect(markup).toContain('title="The spyglass is available once the explorer arrives."');
    expect(markup).toContain("disabled");
    expect(markup).toMatch(/data-exploration-control="joystick"[^>]*hidden=""/);
    expect(markup).toMatch(/data-exploration-control="look"[^>]*hidden=""/);
    expect(markup).toMatch(/data-exploration-control="look-stick"[^>]*hidden=""/);
  });

  it("renders a refusal notice without normal controls or a destructive action", () => {
    const notice = explorationRefusalNotice("no-safe-spawn");
    const view = selectExplorationOverlayView(homeSnapshot({ notice }))!;
    const markup = renderWithI18n(createElement(ExplorationView, {
      input: null,
      view,
      onLeave: vi.fn(),
      onSpyglass: vi.fn()
    }));
    expect(markup).toContain('aria-label="Exploration status" aria-live="polite" class="exploration-ui__notice"');
    expect(markup).toContain("No safe place to start exploring was found. Nothing was changed.");
    expect(markup).not.toContain("exploration-ui__actions");
    expect(markup).not.toContain("exploration-ui__joystick");
  });

  it("ships the responsive, safe-area, target-size and hidden-HUD styles", () => {
    const hudCss = readFileSync("src/app/settlement-ui/player-hud.css", "utf8");
    expect(hudCss).toContain(".player-hud__exploration {");
    expect(hudCss).toContain('"portrait explore"');
    expect(hudCss).toMatch(/\.player-hud\.has-exploration-entry \.player-hud__exploration \{[\s\S]*?margin-left: -?\d+px;/);
    expect(hudCss).toMatch(/\.player-hud__exploration \{[\s\S]*?width: \d+px;/);
    expect(hudCss).toMatch(/\.player-hud__exploration \{[\s\S]*?height: \d+px;/);
    expect(hudCss).toMatch(/\.player-hud__exploration \{[\s\S]*?min-width: \d+px;/);
    expect(hudCss).toMatch(/\.player-hud__exploration \{[\s\S]*?min-height: \d+px;/);
    expect(hudCss).toContain("grid-area: explore;");
    expect(hudCss).toContain(".player-hud.is-portrait-hidden.has-exploration-entry");
    expect(hudCss).toContain("@media (max-width: 480px) and (orientation: portrait)");
    expect(hudCss).toContain("padding-top: var(--hud-top-clearance);");
    expect(hudCss).toContain(".player-hud__population { display: none; }");
    expect(hudCss).toContain("env(safe-area-inset-top");
    expect(hudCss).toContain(':root[data-exploration-hud="hidden"]');
    expect(hudCss).toContain(".settlement-ui > :not(.settlement-ui__hud-host)");
    expect(hudCss).toContain(".settlement-ui__hud-host > :not(.player-hud)");
    expect(hudCss).toContain(".player-hud > :not(.player-hud__portrait)");
    expect(hudCss).toMatch(/:root\[data-exploration-hud="hidden"\] \.player-hud__portrait\s*\{[^}]*pointer-events:\s*none;/);
    expect(hudCss).toContain(".minimap,");
    expect(hudCss).toContain(".minimap.minimap--exploration");
    expect(hudCss).toContain(".military-controls,");
    expect(hudCss).toContain("prefers-reduced-motion: reduce");

    const overlayCss = readFileSync("src/app/exploration/ui/exploration-ui.css", "utf8");
    expect(overlayCss).toContain("--exploration-hit: 48px;");
    expect(overlayCss).toContain("min-width: var(--exploration-hit);");
    expect(overlayCss).toContain("min-height: var(--exploration-hit);");
    expect(overlayCss).toContain("env(safe-area-inset-top");
    expect(overlayCss).toContain("@media (max-width: 480px)");
    expect(overlayCss).toContain("@media (max-height: 520px)");
    expect(overlayCss).toMatch(/\.exploration-ui__keys \{[\s\S]*?right: calc\(16px \+ var\(--exploration-safe-right\)\);/);
    expect(overlayCss).toMatch(/\.exploration-ui__joystick \{[\s\S]*?bottom: calc\(124px \+ var\(--exploration-safe-bottom\)\);/);
    expect(overlayCss).toMatch(
      /@media \(hover: none\), \(pointer: coarse\) \{[\s\S]*?\.exploration-ui__spyglass-zoom \{[\s\S]*?right: calc\(16px \+ var\(--exploration-safe-right\)\);/
    );
    expect(overlayCss).toContain(".exploration-ui__look-stick {");
    expect(overlayCss).toContain("@media (hover: none) and (pointer: coarse) and (orientation: portrait)");
    expect(overlayCss).toContain('.exploration-ui[data-spyglass="true"] .exploration-ui__look-stick');
    expect(overlayCss).toContain(".exploration-ui__spyglass-mask");
    expect(overlayCss).toContain(".exploration-ui__spyglass {");
    expect(overlayCss).toContain("left: calc(150px + var(--exploration-safe-left));");
    expect(overlayCss).toContain("left: calc(112px + var(--exploration-safe-left));");
    expect(overlayCss).toContain('.exploration-ui__action[aria-pressed="true"]:not(.exploration-ui__spyglass)');
    expect(overlayCss).toContain('.exploration-ui__spyglass[aria-pressed="true"]');
    expect(overlayCss).toContain("outline: 2px solid #9bd1ff;");
    expect(overlayCss).toContain("exploration-spyglass-hover");
    expect(overlayCss).toContain("box-shadow: 0 0 0 100vmax #000");
    expect(overlayCss).toContain("@media (hover: hover) and (pointer: fine)");
    expect(overlayCss).toContain("@media (prefers-reduced-motion: reduce)");
    expect(overlayCss).toContain(".exploration-ui.is-reduced-motion");

    const appCss = readFileSync("src/app/styles.css", "utf8");
    expect(appCss).toContain(".minimap__map");
    expect(appCss).toContain(".minimap__explorer");
    expect(appCss).toMatch(/\.minimap--exploration \{[\s\S]*?bottom: max\(8px, env\(safe-area-inset-bottom\)\) !important;/);
    expect(appCss).toMatch(
      /\.app-window-layer \.minimap\.minimap--exploration \{[\s\S]*?pointer-events: none;/
    );
  });
});
