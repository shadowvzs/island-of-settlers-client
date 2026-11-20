import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

import type { AccountStore } from "../src/app/account/account-store";
import {
  getFieldIds, getFirstInvalid, getStatusClassName, NO_STATUS, toBusyLabel, toErrorStatus,
  toNoticeStatus, withoutError
} from "../src/app/account/form/helpers";
import { focusRacePicker, getRaceOptions, RACES } from "../src/app/account/race-picker/helpers";
import { RacePicker } from "../src/app/account/race-picker/race-picker";
import { AccountScrollView } from "../src/app/account/scroll/account-scroll-view";
import { getLocalAccountsLead } from "../src/app/account/scroll/helpers";
import { LocalAccountsPrompt } from "../src/app/account/scroll/local-accounts-prompt";
import { RegistrationForm } from "../src/app/account/scroll/registration-form";
import type { ShownScrollPage } from "../src/app/account/scroll/scroll-pages";
import { SignInForm } from "../src/app/account/scroll/sign-in-form";
import { AccountSettings } from "../src/app/account/settings/account-settings";
import { LeavePanel } from "../src/app/account/settings/leave-panel";
import { getNextRovingIndex } from "../src/app/components/helpers";
import { createExternalStore } from "../src/app/components/ui-store";
import { renderWithI18n } from "./helpers/render-with-i18n";

const store = {} as AccountStore;
const links = { onGuest: vi.fn(), onSwitchMode: vi.fn() };

describe("account form helpers", () => {
  it("names the hint and error lines of a field and describes the input with both", () => {
    expect(getFieldIds("account", "username", true)).toEqual({
      describedBy: "account-username-hint account-username-error",
      errorId: "account-username-error",
      hintId: "account-username-hint"
    });
    expect(getFieldIds("account-delete", "password", false)).toEqual({
      describedBy: "account-delete-password-error", errorId: "account-delete-password-error", hintId: undefined
    });
  });

  it("finds the first invalid field in focus order and clears one field's error", () => {
    const errors = { password: "Enter a password.", race: "Choose your people." };
    expect(getFirstInvalid(["username", "password"], errors)).toBe("password");
    expect(getFirstInvalid(["username"], errors)).toBeNull();
    expect(withoutError(errors, "password")).toEqual({ race: "Choose your people." });
    expect(withoutError(errors, "username" as never)).toBe(errors);
  });

  it("styles notices apart from errors and swaps busy labels", () => {
    expect(getStatusClassName("account-scroll__status", toErrorStatus("x")))
      .toBe("account-status account-scroll__status");
    expect(getStatusClassName("account-settings__status", toNoticeStatus("x")))
      .toBe("account-status account-settings__status is-notice");
    expect(toBusyLabel(true, "Saving…")).toBe("Saving…");
    expect(toBusyLabel(false, "Saving…")).toBeNull();
  });

  it("words the old local accounts offer with their names and removal date", () => {
    expect(getLocalAccountsLead(["Ragnar", "Livia"], "11/21/2026")).toContain(
      "the browser accounts Ragnar, Livia are no longer used. Their saves are removed on 11/21/2026");
    expect(NO_STATUS.message).toBe("");
  });
});

describe("race picker", () => {
  it("keeps the nation order and puts only the checked helmet (else the first) in the tab order", () => {
    expect(RACES.map(race => race.label)).toEqual(["Roman", "Viking", "Japanese", "Nubian",
      "Indigenous", "Chinese", "Persian", "Classic Maya"]);
    expect(getRaceOptions(null).map(option => option.tabIndex)).toEqual([0, -1, -1, -1, -1, -1, -1, -1]);
    const options = getRaceOptions("japanese");
    expect(options.map(option => [option.checked, option.tabIndex])).toEqual([
      [false, -1], [false, -1], [true, 0], [false, -1],
      [false, -1], [false, -1], [false, -1], [false, -1]
    ]);
    expect(options[2]!.helmet).toMatch(/japanese\.png/);
  });

  it("moves with the arrow keys and wraps", () => {
    expect(getNextRovingIndex("ArrowRight", RACES.length - 1, RACES.length)).toBe(0);
    expect(getNextRovingIndex("ArrowLeft", 0, RACES.length)).toBe(RACES.length - 1);
    expect(getNextRovingIndex("ArrowDown", 1, RACES.length)).toBe(2);
    expect(getNextRovingIndex("ArrowUp", 2, RACES.length)).toBe(1);
    expect(getNextRovingIndex("Home", 2, RACES.length)).toBe(0);
    expect(getNextRovingIndex("End", 0, RACES.length)).toBe(RACES.length - 1);
    expect(getNextRovingIndex("Enter", 2, RACES.length)).toBeNull();
  });

  it("focuses the tabbable helmet", () => {
    const focus = vi.fn();
    const group = { querySelector: vi.fn(() => ({ focus })) } as unknown as HTMLElement;
    focusRacePicker(group);
    expect(group.querySelector).toHaveBeenCalledWith('.race-picker__option[tabindex="0"]');
    expect(focus).toHaveBeenCalled();
    expect(focusRacePicker(null)).toBeUndefined();
  });

  it("renders a labelled radio group of helmet buttons", () => {
    const markup = renderWithI18n(createElement(RacePicker, {
      label: "Player nation", selected: "viking", size: "compact", onSelect: vi.fn()
    }));
    expect(markup).toContain('<div aria-label="Player nation" class="race-picker race-picker--compact" ' +
      'role="radiogroup">');
    expect(markup.match(/role="radio"/g)).toHaveLength(RACES.length);
    expect(markup).toContain('<button aria-checked="true" aria-label="Viking" class="race-picker__option" ' +
      'data-nation="viking" role="radio" tabindex="0" title="Viking');
    expect(markup).toContain("Economy: +5% woodcutting speed");
    expect(markup).toContain("Military: +10% damage for heavy infantry");
    expect(markup).toContain('<img alt="" class="race-picker__helmet" draggable="false"');
    expect(markup).toContain('<span class="race-picker__name">Nubian</span>');
  });
});

describe("account scroll pages", () => {
  it("renders Register with display name, email, password, the nation helmets, the status and the links", () => {
    const markup = renderWithI18n(createElement(RegistrationForm, { ...links, store, onAccount: vi.fn() }));
    expect(markup).toContain('<form class="account-scroll__sheet" noValidate="">');
    expect(markup).toContain('<h1 id="account-scroll-title">Island of Settlers</h1>');
    expect(markup).toContain('<label class="account-field"><span class="account-field__label">Display name</span>' +
      '<input aria-describedby="account-displayName-hint account-displayName-error" aria-invalid="false" ' +
      'autoCapitalize="off" autoComplete="nickname" class="account-field__input" maxLength="32" required="" ' +
      'spellCheck="false" type="text" name="displayName" value=""/>');
    expect(markup).toContain('autoComplete="email" class="account-field__input" maxLength="254" required="" ' +
      'spellCheck="false" type="email" name="email" value=""/>');
    expect(markup).toContain('<small class="account-field__hint" id="account-password-hint">' +
      "At least 10 characters.</small>");
    expect(markup).toContain('<fieldset class="account-races"><legend class="account-field__label">' +
      'Choose your people</legend><div aria-describedby="account-race-error" aria-label="Choose your people" ' +
      'class="race-picker race-picker--large" role="radiogroup">');
    expect(markup).toContain('<button class="account-scroll__submit" type="submit">Register</button>');
    expect(markup).toContain('<p class="account-scroll__switch">Already registered? ' +
      '<button class="account-scroll__link" type="button">Sign in</button></p>');
    expect(markup).toContain('Just looking around? <button class="account-scroll__link" type="button">' +
      "Play as guest</button></p><p class=\"account-scroll__note\">Guests play in this browser only");
  });

  it("renders Sign in with email and password", () => {
    const markup = renderWithI18n(createElement(SignInForm, { ...links, store, onAccount: vi.fn() }));
    expect(markup).toContain('type="email" name="email" value=""/>');
    expect(markup).toContain('autoComplete="current-password"');
    expect(markup).not.toContain("account-field__hint");
    expect(markup).toContain('<button class="account-scroll__submit" type="submit">Sign in</button>');
    expect(markup).toContain('New player? <button class="account-scroll__link" type="button">Register</button>');
    expect(markup).toContain("Play as guest");
  });

  it("renders the old local accounts offer with Export and Not now", () => {
    const markup = renderWithI18n(createElement(LocalAccountsPrompt, {
      removeOn: "11/21/2026", usernames: ["Ragnar"], onExport: vi.fn(), onLater: vi.fn()
    }));
    expect(markup).toContain('<h1 id="account-scroll-title">Saves of old local accounts</h1>');
    expect(markup).toContain('<div class="account-scroll__choices"><button class="account-scroll__submit" ' +
      'type="button">Export their saves</button><button class="account-scroll__submit" type="button">Not now' +
      "</button></div>");
  });

  it("renders the modal dialog between the rollers with the page last shown", () => {
    const pages = createExternalStore<ShownScrollPage | null>(null);
    const empty = renderWithI18n(createElement(AccountScrollView, { pages }));
    expect(empty).toBe('<div aria-labelledby="account-scroll-title" aria-modal="true" class="account-scroll" ' +
      'role="dialog"><div aria-hidden="true" class="account-scroll__roller account-scroll__roller--top"></div>' +
      '<div aria-hidden="true" class="account-scroll__roller account-scroll__roller--bottom"></div></div>');
    pages.set({ id: 1, page: { kind: "signIn", store, onAccount: vi.fn(), ...links } });
    const shown = renderWithI18n(createElement(AccountScrollView, { pages }));
    expect(shown).toContain('account-scroll__roller--top"></div><form class="account-scroll__sheet"');
  });
});

describe("Settings > Account", () => {
  it("renders who is signed in, Log out and the online hint", () => {
    const markup = renderWithI18n(createElement(AccountSettings, { displayName: "Ragnar", logOut: vi.fn() }));
    expect(markup).toBe('<div class="account-settings"><p class="settings-panel__hint">Signed in as Ragnar.</p>' +
      '<div class="account-settings__actions"><button class="account-settings__button" type="button">Log out' +
      '</button></div><p class="settings-panel__hint">Your islands are saved online in your account&#x27;s save slot.' +
      "</p></div>");
    const withSlots = renderWithI18n(createElement(AccountSettings, { displayName: "Ragnar", logOut: vi.fn(),
      switchSlot: vi.fn() }));
    expect(withSlots).toContain('<div class="account-settings__actions"><button class="account-settings__button" ' +
      'type="button">Switch save slot</button><button class="account-settings__button" type="button">Log out');
  });

  it("renders the log out confirmation in place", () => {
    const markup = renderWithI18n(createElement(LeavePanel, { confirmLabel: "Save and log out",
      id: "account-logout-question", question: "Save the game and log out?", onClose: vi.fn(), onConfirm: vi.fn() }));
    expect(markup).toBe('<div aria-labelledby="account-logout-question" class="account-settings__panel" ' +
      'role="group"><p class="account-settings__question" id="account-logout-question">Save the game and log out?' +
      '</p><div class="account-settings__row"><button class="account-settings__button" type="button">' +
      'Save and log out</button><button class="account-settings__button" type="button">Cancel</button></div>' +
      '<p class="account-status account-settings__status" role="alert"></p></div>');
  });
});
