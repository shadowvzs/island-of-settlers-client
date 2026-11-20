import { setupI18n } from "@lingui/core";
import { expect, it } from "vitest";

import { getActionButtons, getArmyRailView, INITIAL_ARMY_RAIL_STATE } from "../src/app/settlement/army-rail/helpers";
import { messages as english } from "../src/locales/en/messages";
import { messages as hungarian } from "../src/locales/hu/messages";
import { translateDomainText } from "../src/shared/i18n/domain";

it.each([
  { locale: "en", messages: english, expected: "Choose your military building." },
  { locale: "hu", messages: hungarian, expected: "Válaszd ki a katonai épületedet." }
])("uses the current garrison prompt through the actual compiled $locale catalogue", ({ expected, locale, messages }) => {
  const i18n = setupI18n({ locale, messages: { [locale]: messages } });
  expect(translateDomainText("Choose your military building.", i18n)).toBe(expected);
});

it("the actual rail tooltip asks for foot soldiers and offers no cavalry recruitment", () => {
  const buttons = getActionButtons({ ...INITIAL_ARMY_RAIL_STATE, canEnter: false });
  expect(buttons.find(button => button.action === "enter")).toMatchObject({
    disabled: true, title: "Select foot soldiers to enter a military building"
  });
  expect(buttons.map(button => button.label).join(" ")).not.toMatch(/cavalry|recruit.*horse/i);
});

it("hides the retired rally choice until an actual historical rider is available", () => {
  expect(getArmyRailView(INITIAL_ARMY_RAIL_STATE).choices.map(choice => choice.type))
    .toEqual(["shield", "heavy", "archer"]);
  const legacy = { ...INITIAL_ARMY_RAIL_STATE, free: { ...INITIAL_ARMY_RAIL_STATE.free, cavalry: 1 } };
  expect(getArmyRailView(legacy).choices.find(choice => choice.type === "cavalry"))
    .toMatchObject({ count: "1", disabled: false });
});
