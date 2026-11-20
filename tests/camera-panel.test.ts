import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createExternalStore } from "../src/app/components/ui-store";
import { MinimapHeader } from "../src/app/minimap/minimap-header";
import { createCameraBookmarkControls } from "../src/app/settings/camera/bookmark-controls";
import { createCameraPad } from "../src/app/settings/camera/camera-pad";
import { CameraPanel } from "../src/app/settings/camera/camera-panel-view";
import { getBookmarkRows, getBookmarkStatus, getZoomLimits } from "../src/app/settings/camera/helpers";
import { createHoldRepeat } from "../src/app/settings/camera/hold-repeat";
import { createZoomControl } from "../src/app/settings/camera/zoom-control";
import { createCamera, MAX_ZOOM } from "../src/render-common/camera-state";

const noop = () => undefined;

/** Frames run on demand: `step(ms)` advances the clock and runs the queued callbacks once. */
const stubFrames = () => {
  let now = 0;
  let queued: FrameRequestCallback[] = [];
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("performance", { now: () => now });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => queued.push(callback));
  return {
    pending: () => queued.length,
    step: (ms: number) => {
      now += ms;
      const run = queued;
      queued = [];
      for (const callback of run) callback(now);
    }
  };
};

afterEach(() => vi.unstubAllGlobals());

describe("camera panel services", () => {
  it("publishes zoom limits only when one changes and stops its frame loop while hidden", () => {
    const frames = stubFrames();
    let shown = true;
    const camera = { ...createCamera(64, 64, MAX_ZOOM / 1.1), viewportHeight: 800, viewportWidth: 1280 };
    const zoom = createZoomControl({ camera, cellsX: 128, cellsZ: 128, isShown: () => shown });
    const published = vi.fn();
    zoom.limits.subscribe(published);
    zoom.start();
    expect(zoom.limits.getSnapshot()).toBe(getZoomLimits(true, true));
    zoom.press(1, 0);
    for (let frame = 0; frame < 40; frame++) frames.step(16);
    expect(camera.zoom).toBe(MAX_ZOOM);
    expect(zoom.limits.getSnapshot()).toBe(getZoomLimits(false, true));
    expect(published).toHaveBeenCalledTimes(1);
    zoom.click(-1, 1);
    expect(camera.zoom).toBe(MAX_ZOOM);
    zoom.click(-1, 0);
    frames.step(16);
    expect(published).toHaveBeenCalledTimes(2);
    shown = false;
    frames.step(16);
    expect(frames.pending()).toBe(0);
  });

  it("repeats a held pad button every frame until released or hidden", () => {
    const frames = stubFrames();
    const apply = vi.fn();
    const hold = createHoldRepeat(apply);
    const button = { closest: () => null, isConnected: true, setPointerCapture: vi.fn() };
    const press = { button: 0, currentTarget: button as unknown as Element, pointerId: 3 };
    hold.press(press);
    hold.press(press);
    expect(button.setPointerCapture).toHaveBeenCalledWith(3);
    frames.step(20);
    expect(apply.mock.calls.map(([seconds]) => seconds)).toEqual([0.12, 0.12, 0.02]);
    hold.release();
    frames.step(20);
    expect(frames.pending()).toBe(0);
    hold.click(1);
    hold.click(0);
    expect(apply).toHaveBeenCalledTimes(4);
  });

  it("publishes bookmark changes and restores the view mode through the callbacks", () => {
    const camera = createCamera(20, 30, 2);
    const onRestore = vi.fn(), setViewMode = vi.fn();
    const bookmarks = createCameraBookmarkControls({
      camera, mapSize: [64, 64], getViewMode: () => "cinematic", onRestore, setViewMode
    });
    expect(bookmarks.add(" ")).toBe(false);
    expect(bookmarks.entries.getSnapshot()).toEqual([]);
    expect(bookmarks.add("Coast")).toBe(true);
    camera.centerX = 1;
    bookmarks.go(0);
    expect([camera.centerX, onRestore.mock.calls.length, setViewMode.mock.calls[0]]).toEqual([20, 1, ["cinematic"]]);
    expect(getBookmarkRows(bookmarks.entries.getSnapshot())).toEqual([
      { deleteLabel: "Delete bookmark Coast", goLabel: "Go to Coast", index: 0, key: "0:Coast", name: "Coast" }
    ]);
    bookmarks.remove(0);
    expect(bookmarks.saveState()).toEqual([]);
    expect(getBookmarkStatus(3, false)).toBe("3/8 views on this island. Saved with your game.");
    expect(getBookmarkStatus(3, true)).toBe("Enter a view name (up to 40 characters).");
  });
});

describe("camera panel markup", () => {
  it("renders zoom, pad, view, observation and bookmark controls with their names", () => {
    stubFrames();
    const camera = { ...createCamera(64, 64, MAX_ZOOM), viewportHeight: 800, viewportWidth: 1280 };
    const bookmarks = createCameraBookmarkControls({
      camera, mapSize: [128, 128], getViewMode: () => "iso", onRestore: noop, setViewMode: noop
    });
    bookmarks.add("Harbour");
    const markup = renderToStaticMarkup(createElement(CameraPanel, {
      bookmarks,
      cinematic: createExternalStore(true),
      pad: createCameraPad(camera, [128, 128]),
      zoom: createZoomControl({ camera, cellsX: 128, cellsZ: 128, isShown: () => true }),
      onCinematic: noop,
      onReset: noop,
      onWatch: noop
    }));
    expect(markup).toContain('<div aria-label="Zoom camera" class="camera-control-row camera-zoom-controls" '
      + 'role="group"><button aria-label="Zoom in" class="settings__icon camera-control-button" disabled="" title="Zoom in" '
      + 'type="button"><img alt="" class="camera-control-icon" draggable="false" height="36" src=');
    expect(markup).toContain('<button aria-label="Zoom out" class="settings__icon camera-control-button" title=');
    expect(markup).toContain('<div aria-label="Move camera" class="camera-control-pad" role="group">'
      + '<button aria-label="Move up" class="camera-control-button" style="grid-area:1 / 2" title="Move up"');
    expect(markup).toContain('<div aria-label="Rotate camera" class="camera-control-grid" role="group">');
    expect(markup).toContain('<button aria-label="Cinematic camera (C)" aria-pressed="true" '
      + 'class="camera-control-button is-active"');
    expect(markup).toContain('<div class="camera-observation-controls"><div class="camera-control-row">'
      + '<button aria-label="Inspect a worker without issuing an order" class="settlement-ui__button" '
      + 'title="Inspect a worker without issuing an order" type="button">');
    expect(markup).toContain('<span>Watch worker</span></button><button aria-label="Inspect a visible ship" '
      + 'class="settlement-ui__button" title="Inspect a visible ship" type="button">');
    expect(markup).toContain('<span>Watch ship</span></button></div></div>');
    expect(markup).toContain('<section aria-label="Camera bookmarks" class="camera-bookmarks">');
    expect(markup)
      .toContain('<input aria-label="Bookmark name" maxLength="40" placeholder="Name this view" value=""/>');
    expect(markup).toContain('aria-label="Go to Harbour"');
    expect(markup).toContain('aria-label="Delete bookmark Harbour"');
    expect(markup).toContain('<p role="status">1/8 views on this island. Saved with your game.</p>');
  });

  it("renders no Watch launchers without an observation panel", () => {
    stubFrames();
    const camera = { ...createCamera(64, 64, MAX_ZOOM), viewportHeight: 800, viewportWidth: 1280 };
    const markup = renderToStaticMarkup(createElement(CameraPanel, {
      cinematic: createExternalStore(false),
      pad: createCameraPad(camera, [128, 128]),
      zoom: createZoomControl({ camera, cellsX: 128, cellsZ: 128, isShown: () => true }),
      onCinematic: noop,
      onReset: noop
    }));
    expect(markup).not.toContain("camera-observation-controls");
  });

  it("renders the minimap header title and territory toggle state", () => {
    const territory = createExternalStore(false);
    expect(renderToStaticMarkup(createElement(MinimapHeader, { territory })))
      .toContain('<strong>Minimap</strong><button aria-label="Show occupied territory" aria-pressed="false" '
        + 'class="minimap__territory-toggle" title="Show occupied territory" type="button">');
    territory.set(true);
    expect(renderToStaticMarkup(createElement(MinimapHeader, { territory }))).toContain('aria-pressed="true"');
    const editor = renderToStaticMarkup(createElement(MinimapHeader, { showTerritory: false, territory }));
    expect(editor).toContain("<strong>Minimap</strong>");
    expect(editor).not.toContain("Show occupied territory");
    expect(editor).not.toContain("minimap__territory-toggle");
  });
});
