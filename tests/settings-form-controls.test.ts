import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ApplyRow } from "../src/app/components/apply-row";
import { Checkbox } from "../src/app/components/checkbox";
import { DomSlot } from "../src/app/components/dom-slot";
import {
  formatLevelCaption,
  formatPercentCaption,
  getActiveClassName,
  getApplyRowClassName,
  getChoiceIndex,
  getChoiceValue,
  getSectionIcon,
  toPercent
} from "../src/app/components/helpers";
import { Section } from "../src/app/components/section";
import { Select } from "../src/app/components/select";
import { LevelSlider, Slider } from "../src/app/components/slider";

const noop = () => undefined;
const CHOICES = [{ label: "None", value: 0 }, { label: "1 min", value: 1 }, { label: "1 h", value: 60 }];

describe("settings form helpers", () => {
  it("uses option indices as select values, falling back to the first option", () => {
    expect(getChoiceIndex(CHOICES, 60)).toBe("2");
    expect(getChoiceIndex(CHOICES, 7)).toBe("0");
    expect(getChoiceValue(CHOICES, "1")).toBe(1);
  });

  it("formats the slider captions the e2e drivers query", () => {
    expect(formatLevelCaption("Detail", ["Low", "High"], 1)).toBe("Detail: High");
    expect(toPercent(0.456)).toBe(46);
    expect(formatPercentCaption("Environment volume", 46)).toBe("Environment volume: 46 %");
  });

  it("maps section icons, apply row and toggle classes", () => {
    expect(getSectionIcon("Time & weather")).toBe("weather");
    expect(getSectionIcon("Explore")).toBe("settings");
    expect(getApplyRowClassName(false)).toBe("settings-panel__apply-row");
    expect(getApplyRowClassName(true)).toBe("settings-panel__apply-row settings-panel__apply-row--centered");
    expect(getActiveClassName(true)).toBe("is-active");
    expect(getActiveClassName(false)).toBeUndefined();
  });
});

describe("settings form primitives", () => {
  it("renders a paper checkbox inside its label", () => {
    const markup = renderToStaticMarkup(createElement(Checkbox, {
      checked: true, label: "Fog of war", title: "Show or hide fog", onChange: noop
    }));
    expect(markup).toBe(
      '<label class="settings-panel__check" title="Show or hide fog">'
        + '<input type="checkbox" checked=""/><span class="settings-panel__check-text">Fog of war</span></label>'
    );
  });

  it("renders a select whose option values are indices, the chosen value selected", () => {
    const markup = renderToStaticMarkup(createElement(Select<number>, {
      choices: CHOICES, label: "Autosave", name: "autosave", selected: 60, onChange: noop
    }));
    expect(markup).toContain('<label class="settings-panel__select">Autosave<select aria-label="Autosave" name="autosave">');
    expect(markup).toContain('<option value="0">None</option>');
    expect(markup).toContain('<option value="2" selected="">1 h</option>');
  });

  it("renders the level slider caption as `Name: level` and its range over the levels", () => {
    const markup = renderToStaticMarkup(createElement(LevelSlider, {
      label: "Detail", level: 2, levels: ["Minimal", "Low", "Medium", "High"], onInput: noop
    }));
    expect(markup).toMatch(/^<label class="settings-panel__slider"><span>Detail: Medium<\/span><input /);
    expect(markup).toContain('max="3"');
    expect(markup).toContain('value="2"');
  });

  it("renders a 0..100 % slider", () => {
    const markup = renderToStaticMarkup(createElement(Slider, {
      label: "Environment volume", value: 0.5, onInput: noop
    }));
    expect(markup).toContain("<span>Environment volume: 50 %</span>");
    expect(markup).toContain('max="100"');
    expect(markup).toContain('value="50"');
  });

  it("renders a titled section with its rendered icon", () => {
    // `children` is a required prop in Section's type, so the typed createElement call passes it as a prop.
    // oxlint-disable-next-line react/no-children-prop
    const markup = renderToStaticMarkup(createElement(Section, { children: "content", title: "Sound" }));
    expect(markup).toMatch(/^<section class="settings-panel__section"><h2><svg [^>]*data-icon="sound"/);
    expect(markup).toContain("</svg>Sound</h2>content</section>");
  });

  it("renders the apply tick disabled until the pending choice differs", () => {
    const props = { children: "x", label: "Apply resolution (reloads the game)", onApply: noop };
    const idle = renderToStaticMarkup(createElement(ApplyRow, { ...props, canApply: false, centered: true }));
    expect(idle).toContain('class="settings-panel__apply-row settings-panel__apply-row--centered"');
    expect(idle).toContain(
      'aria-label="Apply resolution (reloads the game)" class="settings-panel__apply" disabled=""'
    );
    const ready = renderToStaticMarkup(createElement(ApplyRow, { ...props, canApply: true }));
    expect(ready).toContain('class="settings-panel__apply-row"');
    expect(ready).not.toContain("disabled");
  });

  it("renders an empty host for existing DOM nodes", () => {
    const markup = renderToStaticMarkup(createElement(DomSlot, {
      className: "settings-panel__shortcuts", label: "Settings shortcuts", nodes: [], role: "group"
    }));
    expect(markup).toBe('<div aria-label="Settings shortcuts" class="settings-panel__shortcuts" role="group"></div>');
  });
});
