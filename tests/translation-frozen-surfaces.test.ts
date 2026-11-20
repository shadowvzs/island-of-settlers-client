import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { validateDisplayName } from "../src/app/account/account-validation";
import { getDisplayNameHint } from "../src/app/account/form/helpers";
import { getRaceOptions } from "../src/app/account/race-picker/helpers";
import { getLocalAccountsLead } from "../src/app/account/scroll/helpers";
import { AccountSettings } from "../src/app/account/settings/account-settings";
import { getSignedInHint } from "../src/app/account/settings/helpers";
import { describeSlot, getCloudStatusView, getRestoreLead, getSlotsLead, getVerificationView } from "../src/app/cloud/helpers";
import { getPanelCloseLabel, getWindowFrameLabels } from "../src/app/components/window/helpers";
import { LOADING_MESSAGES } from "../src/app/loading-messages";
import { SESSION_MESSAGES } from "../src/app/session-messages";
import { getLanguageStatus } from "../src/app/settings/language/helpers";
import {
  getDetailLevels,
  getResolutionOptions,
  getSoundLayerRows,
  getTimePresetButtons
} from "../src/app/settings/sections/helpers";
import { SETTINGS_MESSAGES } from "../src/app/settings/sections/messages";
import { getLauncherRows } from "../src/app/settlement-ui/hud/helpers";
import { getPortraitToggle } from "../src/app/settlement-ui/player-hud/helpers";
import { translateLabel, translateMessage } from "../src/shared/i18n/translate";
import { createTestI18n, renderWithI18n } from "./helpers/render-with-i18n";

describe("reviewed Hungarian catalog for the frozen surfaces", () => {
  const i18n = createTestI18n("hu");

  it("translates the settled Settings labels, options and chrome", () => {
    expect(getDetailLevels("low", i18n)).toEqual(["Minimális", "Alacsony (ajánlott)", "Közepes", "Magas"]);
    expect(getResolutionOptions(i18n).map(option => option.label)).toEqual([
      "Automatikus (könnyebb telefonokon)", "Éles (natív)", "Kiegyensúlyozott", "Gyors"
    ]);
    expect(getTimePresetButtons(i18n).map(button => button.label)).toEqual(["Hajnal", "Nappal", "Alkony", "Éjszaka"]);
    expect(getSoundLayerRows(new Set(), i18n).map(row => row.label)).toEqual([
      "Tenger és folyók", "Levelek és szél", "Eső / hó", "Vadvilág"
    ]);
    expect(getWindowFrameLabels("ship register", i18n)).toEqual({
      close: "ship register ablak bezárása",
      move: "ship register ablak mozgatása. Húzd, vagy használd a nyílbillentyűket."
    });
    expect(getPanelCloseLabel("Camera controls", i18n)).toBe("camera controls panel bezárása");
    expect(translateLabel(i18n, SETTINGS_MESSAGES.panelTitle)).toBe("Beállítások");
    expect(getLanguageStatus({ locale: "hu", saved: true }, i18n)).toBe("Kiválasztva: Magyar.");
  });

  it("translates stable HUD launchers, player-corner labels and loading copy", () => {
    const rows = getLauncherRows(
      { blocked: false, homeIsland: false, minimapVisible: false, notificationCount: 3 },
      i18n
    );
    expect(rows.map(row => row.label)).toEqual(["Építés", "Tárgykészlet", "Térkép", "Menü", "Hírek", "Support"]);
    expect(rows[4]!.title).toBe("Értesítések (3)");
    expect(getPortraitToggle(true, "2. szint", i18n)).toEqual({
      label: "Portré megjelenítése",
      title: "2. szint · kattints a portré megjelenítéséhez"
    });
    expect(translateMessage(i18n, LOADING_MESSAGES.catchUp.progress, { percent: 42 }))
      .toBe("Szigeteid frissítése a távollét alatt eltelt idővel… 42%");
    expect(translateMessage(i18n, LOADING_MESSAGES.failure.message))
      .toBe("A szigetet nem sikerült betölteni. Próbáld újra.");
  });

  it("translates stable session, cloud-status and account chrome", () => {
    expect(translateMessage(i18n, SESSION_MESSAGES.background.saveFailed))
      .toBe("A szigetet nem sikerült menteni a lap elrejtése előtt; az automatikus mentés újrapróbálja.");
    expect(translateMessage(i18n, SESSION_MESSAGES.resume.updating))
      .toBe("A sziget frissítése a távollét idejével…");
    expect(translateMessage(i18n, LOADING_MESSAGES.colony.charting))
      .toBe("A kolónia szigetének feltérképezése…");
    expect(getCloudStatusView({ kind: "offline", retryAt: 5000 }, 1000, i18n)).toEqual({
      text: "Offline: ebben a böngészőben mentve, újrapróbálkozás 4 mp múlva",
      warning: true
    });
    expect(getVerificationView({
      flag: null, flaggedAt: null, pending: true, revision: 3, verifiedRevision: 2
    }, i18n)).toEqual({ text: "ellenőrzés folyamatban" });
    expect(describeSlot(2, undefined, i18n)).toBe("2. hely: üres, indíts új szigetet");
    expect(getSlotsLead("Livia", i18n)).toContain("Üdv, Livia!");
    expect(getRestoreLead(1000, null, i18n)).toContain("Az online hely még üres.");
    expect(getSignedInHint("Ragnar", i18n)).toBe("Bejelentkezve: Ragnar.");
    expect(validateDisplayName("Al", i18n)).toBe("A megjelenő név 3-32 karakter hosszú legyen.");
    expect(getDisplayNameHint(i18n)).toBe("Más játékosok látják: betűk és számok, 3-32.");
    expect(getRaceOptions(null, i18n).slice(0, 4).map(option => option.label))
      .toEqual(["Római", "Viking", "Japán", "Núbiai"]);
    expect(getLocalAccountsLead(["Ragnar"], "2026. 11. 21.", i18n))
      .toContain("a Ragnar böngészőfiók már nem használható");
    expect(getLocalAccountsLead(["Ragnar", "Livia"], "2026. 11. 21.", i18n))
      .toContain("a Ragnar, Livia böngészőfiókok már nem használhatók");
  });

  it("renders the translated account settings chrome with its accessible labels", () => {
    const markup = renderWithI18n(createElement(AccountSettings, {
      displayName: "Ragnar", logOut: vi.fn()
    }), "hu");
    expect(markup).toContain("Bejelentkezve: Ragnar.");
    expect(markup).toContain(">Kijelentkezés</button>");
    expect(markup).toContain("A szigeteid online mentődnek a fiókodhoz tartozó mentési helyen.");
  });

  it("keeps English as the source fallback", () => {
    expect(getLauncherRows({ blocked: false, homeIsland: false, minimapVisible: false, notificationCount: 1 })[0]!
      .label)
      .toBe("Build");
    expect(getWindowFrameLabels("info").close).toBe("Close info window");
    expect(getPortraitToggle(false, "Level 2").title).toBe("Level 2 · click to hide the portrait");
    expect(getCloudStatusView({ at: 1, kind: "saved" }, 0)!.text).toBe("Saved online");
    expect(validateDisplayName("Al")).toBe("The display name must be 3-32 characters long.");
  });
});
