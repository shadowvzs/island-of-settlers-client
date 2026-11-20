import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { CatapultAmmoSection } from "../src/app/settlement-ui/building-details/catapult-ammo-section";
import { renderWithI18n } from "./helpers/render-with-i18n";

describe("Catapult ammo selector (CAT-4)", () => {
  it("renders all five kinds and marks the current choice", () => {
    const markup = renderWithI18n(createElement(CatapultAmmoSection, {
      ammo: "basalt", uid: 7, onChange: () => true
    }));
    for (const kind of ["stone", "basalt", "limestone", "granite", "marble"]) {
      expect(markup).toContain(`data-catapult-ammo="${kind}"`);
    }
    expect(markup).toContain('data-catapult-ammo="basalt"');
    expect(markup).toContain('aria-checked="true"');
    expect(markup).toContain("range ×0.8");
    expect(markup).toContain("impact ×1.5");
  });

  it("shows icons only and describes the selected kind below the row", () => {
    const markup = renderWithI18n(createElement(CatapultAmmoSection, { ammo: "basalt", uid: 7, onChange: () => true }));
    expect(markup).not.toContain("<span>");
    expect(markup).toContain("Basalt: range 8 tiles (−20%), impact radius +50%, damage normal, flight time normal");
    const granite = renderWithI18n(createElement(CatapultAmmoSection, { ammo: "granite", uid: 7 }));
    expect(granite).toContain("Splits into 5 fragments");
    const marble = renderWithI18n(createElement(CatapultAmmoSection, { ammo: "marble", uid: 7 }), "en");
    expect(marble).toContain("damages only what it hits directly");
  });

  it("is visible but disabled when no command callback is supplied", () => {
    const markup = renderWithI18n(createElement(CatapultAmmoSection, { ammo: "stone", uid: 7 }));
    expect(markup).toContain("data-catapult-ammo=\"stone\"");
    expect(markup).toMatch(/<button[^>]*disabled/);
  });
});
