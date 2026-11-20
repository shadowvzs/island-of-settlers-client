import { describe, expect, it } from "vitest";

import { translateDomainText } from "../src/shared/i18n/domain";
import { createTestI18n } from "./helpers/render-with-i18n";

describe("last storage access refusal translation", () => {
  it.each([
    ["The paid trade storage is no longer available",
      "A kifizetett kereskedelmi áru raktára már nem érhető el."],
    ["Build a harbour on this island to collect wares",
      "Az áruk begyűjtéséhez építs kikötőt ezen a szigeten."],
    ["Move the local boats and hand carts before removing this last storage access",
      "Az utolsó raktári hozzáférési pont eltávolítása előtt helyezd át a helyi csónakokat és kézikocsikat."],
    ["Empty the local storage pool and finish its transport commitments before removing its last access",
      "Az utolsó hozzáférési pont eltávolítása előtt ürítsd ki a helyi közös raktárkészletet, és fejezd be a hozzá tartozó szállításokat."]
  ])("localizes the actual plain domain reason: %s", (source, translated) => {
    const i18n = createTestI18n("en");
    expect(translateDomainText(source, i18n)).toBe(source);
    i18n.activate("hu");
    expect(translateDomainText(source, i18n)).toBe(translated);
    expect(translateDomainText(source)).toBe(source);
  });
});
