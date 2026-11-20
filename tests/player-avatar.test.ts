import { existsSync, statSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  playerAvatarGenderStorageKey,
  readLocalPlayerAvatarGender,
  resolvePlayerAvatarGender,
  writeLocalPlayerAvatarGender
} from "../src/app/player-avatar/preference";
import {
  getPlayerAvatarSelection,
  initializePlayerAvatar,
  selectedExplorationPortrait,
  setPlayerAvatarGender,
  setPlayerAvatarNation
} from "../src/app/player-avatar/store";
import {
  DEFAULT_PLAYER_AVATAR_GENDER,
  hasPlayerAvatarBody,
  PLAYER_AVATAR_BODIES,
  PLAYER_AVATAR_GENDERS,
  playerAvatarBody
} from "../src/render-common/workers/player-avatar";
import { WORKER_NATIONS } from "../src/render-common/workers/worker-appearance";
import {
  EXPLORATION_PORTRAIT_BODIES,
  resolveExplorationAppearance
} from "../src/renderers/three/exploration/exploration-portrait";

const storage = () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value)
  });
  return values;
};

afterEach(() => vi.unstubAllGlobals());

describe("shared player avatar body table", () => {
  it("ships one animated sheet and one cropped face for every nation and gender", () => {
    for (const nation of WORKER_NATIONS)
      for (const gender of PLAYER_AVATAR_GENDERS) {
        const key = `${nation}-${gender}`;
        for (const file of [
          `assets/ui-icons/portraits/${key}.webp`,
          `assets/ui-icons/portraits/faces/${key}.webp`
        ]) {
          expect(existsSync(file), file).toBe(true);
          expect(statSync(file).size, file).toBeGreaterThan(1_000);
        }
      }
    expect(existsSync("assets/ui-icons/actions/customization.webp")).toBe(true);
  });

  it("has one existing roster body for every nation and both genders", () => {
    for (const nation of WORKER_NATIONS)
      for (const gender of PLAYER_AVATAR_GENDERS) {
        const body = playerAvatarBody(nation, gender);
        expect(body.gender).toBe(gender);
        expect(hasPlayerAvatarBody(nation, body.variant, gender)).toBe(true);
      }
  });

  it("keeps today's canonical gender as the old-account default", () => {
    expect(DEFAULT_PLAYER_AVATAR_GENDER).toEqual({
      indigenous: "male",
      chinese: "male",
      persian: "male",
      maya: "male",
      japanese: "female",
      nubian: "male",
      roman: "male",
      viking: "female"
    });
    for (const nation of WORKER_NATIONS) {
      const defaultGender = DEFAULT_PLAYER_AVATAR_GENDER[nation];
      expect(EXPLORATION_PORTRAIT_BODIES[nation]).toEqual(PLAYER_AVATAR_BODIES[nation][defaultGender]);
    }
  });
});

describe("exploration appearance by nation and gender", () => {
  it("resolves every nation×gender to its shared canonical body", () => {
    for (const nation of WORKER_NATIONS)
      for (const gender of PLAYER_AVATAR_GENDERS) {
        const resolution = resolveExplorationAppearance({ gender, nation });
        expect(resolution.appearance).toEqual({ nation, variant: PLAYER_AVATAR_BODIES[nation][gender].variant });
        expect(resolution.gender).toBe(gender);
        expect(resolution.nationFallback).toBe(false);
      }
  });

  it("falls back within the same nation and gender and discloses a missing body", () => {
    const resolution = resolveExplorationAppearance({
      body: "viking-woman-missing",
      gender: "female",
      nation: "viking"
    });
    expect(resolution.appearance).toEqual({ nation: "viking", variant: "viking-woman-blue" });
    expect(resolution.gender).toBe("female");
    expect(resolution.gaps).toContainEqual({
      field: "body",
      reason: "unavailable",
      requested: "viking-woman-missing"
    });
  });

  it("keeps requested skin/head/hair as baked-body gaps instead of switching the nation", () => {
    const resolution = resolveExplorationAppearance({
      body: "nubian-woman-cream",
      gender: "female",
      hair: "braids",
      nation: "nubian",
      skin: "deep"
    });
    expect(resolution.appearance).toEqual({ nation: "nubian", variant: "nubian-woman-cream" });
    expect(resolution.gaps).toContainEqual({ field: "hair", reason: "baked-into-body", requested: "braids" });
    expect(resolution.gaps).toContainEqual({ field: "skin", reason: "baked-into-body", requested: "deep" });
  });
});

describe("player avatar persistence", () => {
  it("prefers a valid account field, then the local fallback, then the nation default", () => {
    expect(resolvePlayerAvatarGender("female", "male", "roman")).toBe("female");
    expect(resolvePlayerAvatarGender("unknown", "male", "roman")).toBe("male");
    expect(resolvePlayerAvatarGender("unknown", "unknown", "viking")).toBe("female");
    expect(resolvePlayerAvatarGender(undefined, undefined, "nubian")).toBe("male");
  });

  it("stores the guest fallback under the shared key and accounts under their own key", () => {
    const values = storage();
    expect(playerAvatarGenderStorageKey(null)).toBe("island-of-settlers.player-avatar-gender");
    expect(playerAvatarGenderStorageKey("ABC")).toBe("island-of-settlers.player-avatar-gender.abc");
    writeLocalPlayerAvatarGender("abc", "female");
    expect(values.get("island-of-settlers.player-avatar-gender.abc")).toBe("female");
    expect(readLocalPlayerAvatarGender("abc")).toBe("female");
    expect(readLocalPlayerAvatarGender("other")).toBeNull();
    values.set("island-of-settlers.player-avatar-gender", "invalid");
    expect(readLocalPlayerAvatarGender(null)).toBeNull();
  });

  it("survives blocked local storage", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); }
    });
    expect(readLocalPlayerAvatarGender("blocked")).toBeNull();
    expect(() => writeLocalPlayerAvatarGender("blocked", "female")).not.toThrow();
  });

  it("restores the account choice and updates the HUD/exploration selection at once", async () => {
    storage();
    const save = vi.fn(async () => true);
    initializePlayerAvatar({ accountGender: "female", accountId: "account", nation: "roman", saveAccountGender: save });
    expect(getPlayerAvatarSelection()).toEqual({ accountId: "account", gender: "female", nation: "roman" });
    expect(await setPlayerAvatarGender("male")).toBe("account");
    expect(getPlayerAvatarSelection().gender).toBe("male");
    expect(selectedExplorationPortrait("roman")).toEqual({
      body: "roman-man-white",
      gender: "male",
      nation: "roman"
    });
    expect(save).toHaveBeenCalledWith("male");
  });

  it("keeps the local fallback when the account cannot be updated", async () => {
    storage();
    initializePlayerAvatar({
      accountId: "account",
      nation: "viking",
      saveAccountGender: async () => false
    });
    expect(await setPlayerAvatarGender("male")).toBe("failed");
    expect(getPlayerAvatarSelection().gender).toBe("male");
    expect(selectedExplorationPortrait()).toEqual({
      body: "viking-man-blond",
      gender: "male",
      nation: "viking"
    });
    initializePlayerAvatar({ accountId: "account", nation: "viking" });
    expect(getPlayerAvatarSelection().gender, "the device fallback survives a reload").toBe("male");
  });

  it("updates the nation used by possession and the face pair", () => {
    storage();
    initializePlayerAvatar({ accountId: null, nation: "roman" });
    setPlayerAvatarNation("japanese");
    expect(getPlayerAvatarSelection().nation).toBe("japanese");
    const portrait = selectedExplorationPortrait();
    expect(portrait).toEqual({
      body: "japanese-man-grey",
      gender: "male",
      nation: "japanese"
    });
    expect(resolveExplorationAppearance(portrait).appearance).toEqual({
      nation: "japanese",
      variant: "japanese-man-grey"
    });
  });
});
