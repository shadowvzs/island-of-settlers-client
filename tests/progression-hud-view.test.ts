import { createElement, createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { selectPlayerHud } from "../src/app/settlement-ui/player-hud/helpers";
import { PlayerHudView } from "../src/app/settlement-ui/player-hud/player-hud";
import type { SettlementPlayerSummary } from "../src/app/settlement-ui/types";
import { FULL_PROGRESSION, type ProgressionVisibility } from "../src/shared/progression/progression-rules";
import { renderWithI18n } from "./helpers/render-with-i18n";

/** PROG (plan §9.4, owner Q10): the player corner under each row of the visibility table. */

const playerWith = (progression?: ProgressionVisibility): SettlementPlayerSummary => ({
  current: 40, experience: 140, fraction: 0.4, gems: 12, level: 7, nation: "roman", needed: 100, progression,
  quests: [], stock: {}, talents: {}
});

const markup = (progression?: ProgressionVisibility, shopOffered = true) =>
  renderWithI18n(createElement(PlayerHudView, {
  shopOffered,
  className: "player-hud",
  model: selectPlayerHud({ player: playerWith(progression) })!,
  portraitHidden: false,
  portraitRef: createRef<HTMLButtonElement>(),
  portraitStyle: {},
  toggle: { label: "Hide portrait", title: "" },
  onOpenMessages: vi.fn(),
  onOpenQuests: vi.fn(),
  onOpenShop: vi.fn(),
  onOpenTalents: vi.fn(),
  onTogglePortrait: vi.fn()
}));

const LEVEL = 'class="player-hud__level"', BAR = "player-hud__bar", LOCK = "player-hud__level-lock";
const TALENTS = "player-hud__talents";

describe("player corner progression visibility", () => {
  it("shows level, experience bar and talents as today without rules or with everything on", () => {
    for (const html of [markup(), markup(FULL_PROGRESSION)]) {
      expect(html).toContain(LEVEL);
      expect(html).toContain(BAR);
      expect(html).toContain(TALENTS);
      expect(html).not.toContain(LOCK);
    }
  });

  it("experience off: the level star stays, compact and without the bar", () => {
    const html = markup({ ...FULL_PROGRESSION, experienceRewarded: false, experienceShown: false });
    expect(html).toContain(LEVEL);
    expect(html).toContain("player-hud__experience--compact");
    expect(html).not.toContain(BAR);
    expect(html).toContain(TALENTS);
  });

  it("progression off: no level, no experience bar, no talent button; gems stay", () => {
    const html = markup({ experienceRewarded: false, experienceShown: false, levelLocked: false, levelShown: false,
      rewardsShown: true, talentsShown: false });
    expect(html).not.toContain(LEVEL);
    expect(html).not.toContain(BAR);
    expect(html).not.toContain(TALENTS);
    expect(html).toContain("player-hud__gems");
  });

  it("progression off without a shop (GS4b): only the read-only gem chip and the population remain", () => {
    const html = markup({ experienceRewarded: false, experienceShown: false, levelLocked: false, levelShown: false,
      rewardsShown: true, talentsShown: false }, false);
    expect(html).not.toContain(LEVEL);
    expect(html).toContain("player-hud__gems--readonly");
    expect(html).not.toContain('data-ui-anchor="hud.gemShop"');
  });

  it("experience on, talents off: only the talent button goes", () => {
    const html = markup({ ...FULL_PROGRESSION, talentsShown: false });
    expect(html).toContain(BAR);
    expect(html).not.toContain(TALENTS);
  });

  it("a map-fixed level: the number with a lock and no experience bar", () => {
    const html = markup({ ...FULL_PROGRESSION, experienceShown: false, levelLocked: true });
    expect(html).toContain(LEVEL);
    expect(html).toContain(LOCK);
    expect(html).not.toContain(BAR);
    const model = selectPlayerHud({ player: playerWith({ ...FULL_PROGRESSION, experienceShown: false,
      levelLocked: true }) })!;
    expect(model.experienceTotal).toBe("Level 7 · fixed by this map");
  });

  it("the toggle tooltip names no experience where the bar is hidden", () => {
    const hidden = selectPlayerHud({ player: playerWith({ ...FULL_PROGRESSION, experienceShown: false }) })!;
    expect(hidden.experienceTotal).toBe("Level 7");
    expect(selectPlayerHud({ player: playerWith() })!.experienceTotal).toBe("Level 7 · 140 XP in total");
  });
});
