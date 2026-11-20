import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { IconButton } from "../src/app/components/icon-button";
import { createExternalStore } from "../src/app/components/ui-store";
import { getPanelCloseLabel, getWindowFrameLabels } from "../src/app/components/window/helpers";
import { PanelFrame } from "../src/app/components/window/panel-frame";
import { StoredWindowFrame } from "../src/app/components/window/stored-window-frame";
import { WindowFrame } from "../src/app/components/window/window-frame";
import type { WindowFrameState } from "../src/app/components/window/window-frame-controller";
import type { SettlementHudActions } from "../src/app/settlement-ui/hud/types";
import { createMainPanel, type MainPanelVisibility } from "../src/app/settlement-ui/main-panel/main-panel";
import { getMainPanelFrame } from "../src/app/settlement-ui/main-panel/main-panel-helpers";
import { MainPanel } from "../src/app/settlement-ui/main-panel/main-panel-view";
import { createSettlementUiStore } from "../src/app/settlement-ui/ui-store";
import { DEFAULT_STATS_HELP, formatStatsText } from "../src/app/stats-overlay/helpers";
import { StatsOverlayBody } from "../src/app/stats-overlay/stats-overlay-body";
import { renderWithI18n } from "./helpers/render-with-i18n";

const noop = vi.fn();

const HEADER = '<header class="settlement-ui__panel-header"><div aria-label="Move info window. Drag or use arrow keys." '
  + 'class="settlement-ui__drag-handle" role="button" tabindex="0"><svg aria-hidden="true" class="settlement-art-icon" '
  + 'data-icon="drag" focusable="false" viewBox="0 0 24 24">';

describe("window frame", () => {
  it("names its drag handle and close button after the window", () => {
    expect(getWindowFrameLabels("ship register")).toEqual({
      close: "Close ship register window", move: "Move ship register window. Drag or use arrow keys."
    });
    expect(getPanelCloseLabel("Camera controls")).toBe("Close camera controls panel");
  });

  it("renders the dialog section, header, close button with its empty caption and data attributes", () => {
    const markup = renderWithI18n(createElement(WindowFrame, {
      className: "stats-overlay", data: { "data-demolish-confirm": "" }, name: "info", opened: 0, title: "Info",
      titleId: "stats-overlay-title", visible: false, onClose: noop
    }, "body"));
    expect(markup).toMatch(/^<section aria-labelledby="stats-overlay-title" class="settlement-ui__panel stats-overlay" hidden="" role="dialog" data-demolish-confirm="">/);
    expect(markup).toContain(HEADER);
    expect(markup).toContain('<h2 id="stats-overlay-title">Info</h2></div><button aria-label="Close info window" '
      + 'class="settlement-ui__button" title="Close info window" type="button"><svg');
    expect(markup).toContain('data-icon="cancel"');
    expect(markup).toMatch(/<\/svg><span><\/span><\/button><\/header>body<\/section>$/);
  });

  it("shows the title and visibility of its controller's store", () => {
    const state = createExternalStore<WindowFrameState>({ opened: 2, title: "Sawmill", visible: true });
    const markup = renderWithI18n(createElement(StoredWindowFrame, {
      className: "settlement-ui__building-details-window", id: "details-title", name: "building details", state,
      onClose: noop
    }));
    expect(markup).toContain('<section aria-labelledby="details-title" class="settlement-ui__panel '
      + 'settlement-ui__building-details-window" role="dialog">');
    expect(markup).toContain('<h2 id="details-title">Sawmill</h2>');
  });

  it("lets a lazy window refresh its title and drag/close names after a live locale change", () => {
    const state = createExternalStore<WindowFrameState>({
      name: "zenelejátszó", opened: 1, title: "Zenelejátszó", visible: true
    });
    const markup = renderWithI18n(createElement(StoredWindowFrame, {
      className: "music-player-window", id: "music-player-title", name: "music player", state, onClose: noop
    }));
    expect(markup).toContain('<h2 id="music-player-title">Zenelejátszó</h2>');
    expect(markup).toContain('aria-label="Close zenelejátszó window"');
    expect(markup).toContain('aria-label="Move zenelejátszó window. Drag or use arrow keys."');
  });

  it("renders a corner panel with its title and close button", () => {
    const markup = renderWithI18n(createElement(PanelFrame, {
      className: "camera-controls-panel", label: "Camera controls", open: false, onClose: noop
    }));
    expect(markup).toMatch(/^<div class="settings-panel camera-controls-panel" hidden=""><header class="settings-panel__header">/);
    expect(markup).toContain('<strong>Camera controls</strong><button aria-label="Close camera controls panel" '
      + 'class="settings-panel__close" type="button"><svg aria-hidden="true" class="settlement-art-icon settings__icon-image" '
      + 'data-icon="cancel"');
  });
});

describe("icon button", () => {
  it("renders a caption span only when a caption is given, the caption naming it by default", () => {
    const captioned = renderWithI18n(createElement(IconButton, {
      caption: "Credits", className: "settings-panel__shortcut", hasPopup: "dialog", icon: "credits", onClick: noop
    }));
    expect(captioned).toMatch(/^<button aria-haspopup="dialog" aria-label="Credits" class="settlement-ui__button settings-panel__shortcut" title="Credits" type="button">/);
    expect(captioned).toMatch(/<span>Credits<\/span><\/button>$/);
    const plain = renderWithI18n(createElement(IconButton, { icon: "rotate", label: "Rotate", onClick: noop }));
    expect(plain).not.toContain("<span>");
  });

});

describe("info panel body", () => {
  it("formats the frame statistics and renders them above the help", () => {
    const text = formatStatsText(["WARNING"], "high", {
      averageFps: 59.6, cpuMs: 1.234, drawCalls: 12, gpuMs: 2.5, gpuMsP95: 3.25, lowFps: 41.2, triangles: 25_300
    } as never, { details: { birds: "4", trees: 1500 } });
    expect(text).toBe("WARNING\ndetail: high\nfps: 60 (1% low 41)\ngpu: 2.50 ms (p95 3.25), cpu: 1.23 ms\n"
      + "draw calls: 12, triangles: 25.3k\nbirds: 4\ntrees: 1.5k");
    const markup = renderWithI18n(createElement(StatsOverlayBody, {
      text: createExternalStore({ help: DEFAULT_STATS_HELP, stats: "fps: 60" })
    }));
    expect(markup).toContain('<button aria-label="Copy info to clipboard" class="stats-overlay__copy"');
    expect(markup).toContain('<pre>fps: 60</pre><p class="stats-overlay__help">'
      + "drag / arrow keys: pan, wheel: zoom, click a tree: fell it\nleft-click worker: select, right-click ground: move, "
      + "left-click elsewhere: deselect, C: cinematic camera</p></div>");
  });
});

describe("main panel", () => {
  it("opens a view, closes it when opened again and keeps Build closed while blocked", () => {
    let blocked = false;
    const panel = createMainPanel({ isBuildBlocked: () => blocked });
    panel.open("menu");
    expect(panel.visibility.getSnapshot()).toEqual({ opened: 1, view: "menu", visible: true });
    panel.open("notices");
    expect(panel.isShowing("notices")).toBe(true);
    panel.open("notices");
    expect(panel.visibility.getSnapshot()).toEqual({ opened: 2, view: "notices", visible: false });
    blocked = true;
    panel.open("build");
    expect(panel.isShowing("build")).toBe(false);
  });

  it("derives the title, modifier class and shown host from the view", () => {
    const frame = (view: MainPanelVisibility["view"]) => getMainPanelFrame({ opened: 1, view, visible: true });
    expect(frame("menu")).toMatchObject({ className: "settlement-ui__panel--main-selection", hideMenu: false,
      title: "Main selection" });
    expect(frame("notices")).toMatchObject({ className: "settlement-ui__panel--notices", hideBuild: true,
      title: "Notifications" });
    expect(frame("ships")).toMatchObject({ className: "", hideShips: false, title: "Fleet" });
  });

  it("renders the frame around its four exclusive view hosts", () => {
    const panel = createExternalStore<MainPanelVisibility>({ opened: 1, view: "menu", visible: true });
    const actions = { canSurvey: false,
      menuShortcuts: [] as SettlementHudActions["menuShortcuts"] } as unknown as SettlementHudActions;
    const markup = renderWithI18n(createElement(MainPanel, {
      actions, panel, store: createSettlementUiStore()
    }));
    expect(markup).toContain('<section aria-labelledby="settlement-panel-title" class="settlement-ui__panel '
      + 'settlement-ui__panel--main-selection" role="dialog">');
    expect(markup).toContain('aria-label="Move settlement window. Drag or use arrow keys."');
    expect(markup).toContain('<h2 id="settlement-panel-title">Main selection</h2>');
    expect(markup).toContain('<div class="settlement-ui__picker" hidden="">');
    expect(markup).toContain('<div aria-label="Main selection" class="settlement-ui__menu">');
    expect(markup).toContain('<div class="settlement-ui__overview settlement-ui__fleet" hidden=""></div>');
    expect(markup).toContain('<div class="settlement-ui__overview settlement-ui__notices" hidden="">');
  });
});
