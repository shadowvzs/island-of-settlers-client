import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { getObservationLaunchers } from "../src/app/observation/helpers";
import { createCornerRow } from "../src/app/settings/corner-row/corner-row";
import { CornerRow } from "../src/app/settings/corner-row/corner-row-view";
import {
  addCornerButton, type CornerButton, getCornerButtonView, updateCornerButton
} from "../src/app/settings/corner-row/helpers";
import { getSettlementIconSource, resolveSettlementIcon } from "../src/app/settlement-ui/icons";
import { renderWithI18n } from "./helpers/render-with-i18n";

const noop = () => undefined;
const button = (id: string, fields: Partial<CornerButton> = {}): CornerButton =>
  ({ icon: { kind: "settlement", name: "settings" }, id, label: id, onClick: noop, ...fields });

describe("corner row helpers", () => {
  it("prepares classes, ARIA states and the icon of each button", () => {
    expect(getCornerButtonView(button("theme", {
      active: false, className: "hud-theme-toggle", expanded: false, hasPopup: true, pressed: true
    }))).toMatchObject({
      className: "settings__icon hud-theme-toggle", expanded: false, hasPopup: "true", pressed: true,
      settlementIcon: "settings"
    });
    const camera = getCornerButtonView(button("camera", { active: true, icon: { kind: "camera", name: "camera" } }));
    expect(camera.className).toBe("settings__icon is-active");
    expect(camera.cameraIconSource).toMatch(/camera\.png/);
    expect(camera.settlementIcon).toBeUndefined();
    expect(getCornerButtonView(button("plain")).hasPopup).toBeUndefined();
  });

  it("adds first or last and keeps the same array when an update changes nothing", () => {
    const buttons = addCornerButton(addCornerButton([], button("settings"), "end"), button("theme"), "start");
    expect(buttons.map(entry => entry.id)).toEqual(["theme", "settings"]);
    const opened = updateCornerButton(buttons, "settings", { active: true, expanded: true });
    expect(opened).not.toBe(buttons);
    expect(opened[1]).toMatchObject({ active: true, expanded: true });
    expect(opened[0]).toBe(buttons[0]);
    expect(updateCornerButton(opened, "settings", { expanded: true })).toBe(opened);
    expect(updateCornerButton(opened, "missing", { hidden: true })).toBe(opened);
  });
});

describe("corner row store", () => {
  it("publishes only real changes and removes a button", () => {
    const row = createCornerRow();
    const published = vi.fn();
    row.store.subscribe(published);
    row.add(button("development"), { expanded: false });
    row.add(button("theme"), {}, "start");
    row.update("development", { expanded: false });
    expect(published).toHaveBeenCalledTimes(2);
    row.update("development", { active: true, expanded: true });
    expect(published).toHaveBeenCalledTimes(3);
    row.remove("theme");
    expect(row.store.getSnapshot().map(entry => entry.id)).toEqual(["development"]);
  });
});

describe("corner row markup", () => {
  it("renders the buttons with their names, states, hidden flag and icons", () => {
    const row = createCornerRow();
    row.add({ className: "hud-theme-toggle", hasPopup: true, icon: { kind: "settlement", name: "theme" },
      id: "theme", label: "Theme and style", onClick: noop }, { expanded: false, pressed: false });
    row.add(button("settings", { label: "Settings" }), { expanded: false, hidden: true });
    row.add({ icon: { kind: "camera", name: "camera" }, id: "camera", label: "Camera controls", onClick: noop },
      { active: true, expanded: true });
    const markup = renderWithI18n(createElement(CornerRow, { store: row.store }));
    expect(markup).toContain('<button aria-expanded="false" aria-haspopup="true" aria-label="Theme and style" '
      + 'aria-pressed="false" class="settings__icon hud-theme-toggle" title="Theme and style" type="button">'
      + '<svg aria-hidden="true" class="settlement-art-icon settings__icon-image" data-icon="theme"');
    expect(markup).toContain('<button aria-expanded="false" aria-label="Settings" class="settings__icon" hidden="" '
      + 'title="Settings" type="button">');
    expect(markup).toContain('<button aria-expanded="true" aria-label="Camera controls" '
      + 'class="settings__icon is-active" title="Camera controls" type="button">'
      + '<img alt="" class="camera-control-icon" draggable="false" '
      + 'height="36" src=');
  });
});

describe("development tool openers", () => {
  it("resolves a HUD icon URL for image-based tools (the ship for the sail-back pair)", () => {
    const statistics = resolveSettlementIcon("statistics") as { source: string };
    expect(getSettlementIconSource("statistics")).toBe(statistics.source);
    expect(getSettlementIconSource("sailBack")).toBe(getSettlementIconSource("ship"));
  });

  it("Watch launchers start picking their kind", () => {
    const onWatch = vi.fn();
    const launchers = getObservationLaunchers(onWatch);
    expect(launchers.map(({ caption, icon, label }) => [caption, icon, label])).toEqual([
      ["Watch worker", "people", "Inspect a worker without issuing an order"],
      ["Watch ship", "ship", "Inspect a visible ship"]
    ]);
    launchers.forEach(launcher => launcher.onClick());
    expect(onWatch.mock.calls).toEqual([["worker"], ["ship"]]);
  });
});
