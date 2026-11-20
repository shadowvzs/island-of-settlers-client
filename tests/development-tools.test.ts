import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { SwatchPicker } from "../src/app/components/swatch-picker";
import { createExternalStore } from "../src/app/components/ui-store";
import { createEnvironmentController } from "../src/app/environment-controller";
import { DevelopmentSectionView } from "../src/app/settings/development/development-sections";
import { createDevelopmentTool } from "../src/app/settings/development/development-tool";
import { DevelopmentToolGrid } from "../src/app/settings/development/development-tool-grid";
import { WORKER_COLOR_CHOICES } from "../src/app/settings/development/helpers";
import {
  createExpeditionDiscoveryDebug,
  getDiscoveryOverride
} from "../src/app/settings/expedition-discovery-debug";
import type { MilitaryAiDebug } from "../src/app/settlement/military-ai-debug";
import { createWeatherControls } from "../src/app/weather-controls";
import { renderWithI18n } from "./helpers/render-with-i18n";

const noop = () => undefined;
const render = (section: Parameters<typeof DevelopmentSectionView>[0]["section"]) =>
  renderWithI18n(createElement(DevelopmentSectionView, { section }));

describe("development tools", () => {
  it("keeps a tool's live state in its store and renders it as the captioned icon button", () => {
    const tool = createDevelopmentTool({ icon: "fog.svg", label: "Remove fog", title: "Reveal", onClick: noop });
    tool.update({ active: true });
    tool.update({ disabled: true, title: "Not here" });
    expect(tool.state.getSnapshot()).toEqual({ active: true, disabled: true, title: "Not here" });
    const opener = createDevelopmentTool({
      hasPopup: "dialog", icon: "chart.webp", label: "Historical military benchmark", title: "Archived", onClick: noop
    });
    const markup = renderWithI18n(createElement(DevelopmentToolGrid, { tools: [tool, opener] }));
    expect(markup).toContain('<div class="development-menu__items"><div class="development-menu__item">'
      + '<button aria-label="Remove fog" aria-pressed="true" class="settings__icon is-active" disabled="" '
      + 'title="Not here" type="button"><img alt="" height="36" src="fog.svg" width="36"/></button>'
      + '<span>Remove fog</span></div><div class="development-menu__item"><button aria-haspopup="dialog" '
      + 'aria-label="Historical military benchmark" class="settings__icon" title="Archived" type="button">'
      + '<img alt="" height="36" src="chart.webp" width="36"/></button>'
      + '<span>Historical military benchmark</span></div></div>');
  });

  it("uses the shared captionless compact control for Create ship", () => {
    const tool = createDevelopmentTool({ icon: "unused.png", label: "Create ship", sharedIcon: "ship",
      title: "Click clear sea", onClick: noop });
    tool.update({ active: false });
    expect(renderWithI18n(createElement(DevelopmentToolGrid, { tools: [tool] })))
      .toContain('aria-label="Create ship" aria-pressed="false"');
    tool.update({ active: true });
    const markup = renderWithI18n(createElement(DevelopmentToolGrid, { tools: [tool] }));
    expect(markup).toContain('aria-label="Create ship" aria-pressed="true"');
    expect(markup).toContain("settlement-ui__icon-button--compact");
    expect(markup).not.toContain("unused.png");
    expect(markup).toContain('class="settlement-art-icon"');
    expect(markup).toContain("</button><span>Create ship</span>");
  });

  it("renders the development panel copy in Hungarian", () => {
    const markup = renderWithI18n(createElement(DevelopmentSectionView, {
      section: { checked: true, kind: "reveal-ore", onChange: noop }
    }), "hu");
    expect(markup).toContain("Ércjelőhelyek felfedése (újratölt)");
    expect(markup).toContain("Hibakeresési láthatóság");
  });

  it("renders the reveal ore checkbox, the moved Time & weather controls and the worker colour swatches", () => {
    expect(render({ checked: true, kind: "reveal-ore", onChange: noop }))
      .toContain(
        '<input type="checkbox" checked=""/><span class="settings-panel__check-text">Reveal ore deposits</span></label>'
      );
    const weather = createWeatherControls(createEnvironmentController(
      { azimuthX: -.94, azimuthZ: -.34, elevation: .7 }, { hour: 6.5, rain: true, snow: false }
    ));
    const weatherMarkup = render({ kind: "weather", weather });
    expect(weatherMarkup).toContain("<h2>");
    expect(weatherMarkup).toContain("Time &amp; weather");
    expect(weatherMarkup).toContain('<span class="weather-controls__clock">06:30</span>');
    expect(weatherMarkup).toContain('<button class="is-active" type="button">Rain</button>');
    const workers = render({
      color: WORKER_COLOR_CHOICES[1]!.value, kind: "workers", onColorChange: noop,
      onNationChange: async () => undefined
    });
    expect(workers).toContain('class="race-picker race-picker--compact"');
    for (const nation of ["roman", "japanese", "nubian", "viking"])
      expect(workers).toContain(`data-nation="${nation}"`);
    expect(workers).toContain('<div aria-label="Worker colour" class="settings-panel__swatches" role="group">');
    expect(workers.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(workers).toContain(`aria-label="${WORKER_COLOR_CHOICES[1]!.label}" aria-pressed="true"`);
  });

  it("renders a swatch picker as a labelled group of colour buttons", () => {
    const markup = renderWithI18n(createElement(SwatchPicker<string>, {
      choices: [{ color: "#f00", label: "Red", value: "red" }], label: "Colour", selected: "red", onChange: noop
    }));
    expect(markup).toBe('<div aria-label="Colour" class="settings-panel__swatches" role="group"><span>Colour</span>'
      + '<div class="settings-panel__swatch-row"><button aria-label="Red" aria-pressed="true" '
      + 'class="settings-panel__swatch" style="background:#f00" title="Red" type="button"></button></div></div>');
  });
});

describe("expedition discovery debug", () => {
  it("overrides only the chosen month / theme and restyles the visit on an explicit theme", () => {
    expect(getDiscoveryOverride("", "")).toBeUndefined();
    expect(getDiscoveryOverride("3", "")).toEqual({ month: 3 });
    const onCurrentTheme = vi.fn();
    const debug = createExpeditionDiscoveryDebug({ currentTheme: "winter", onCurrentTheme });
    expect(debug.override()).toEqual({ theme: "winter" });
    debug.setTheme("");
    expect(onCurrentTheme).not.toHaveBeenCalled();
    debug.setMonth("12");
    expect(debug.override()).toEqual({ month: 12 });
    const markup = render({ debug, kind: "expedition-discovery" });
    expect(markup).toContain('<select aria-label="Month"><option value="0">Real calendar</option>');
    expect(markup).toContain('<option value="12" selected="">December</option>');
    expect(markup).toContain('<label class="settings-panel__select">Island theme<select aria-label="Island theme">');
  });
});

describe("military AI debug", () => {
  const debugOf = (mode: ReturnType<MilitaryAiDebug["getMode"]>): MilitaryAiDebug =>
    ({ dispose: noop, getMode: () => mode, setOverlayVisible: noop });

  it("shows the fixed shipped mode and the overlay once the simulation exists", () => {
    const store = createExternalStore<MilitaryAiDebug | null>(null);
    expect(render({ debug: store, kind: "military-ai" })).toBe("");
    store.set(debugOf("flowCommander"));
    const markup = render({ debug: store, kind: "military-ai" });
    expect(markup).toContain("Mode: Flow fields + commander (shipped)");
    expect(markup).not.toContain("<select");
    expect(markup).toContain("AI debug overlay (flow, influence)");
  });
});
