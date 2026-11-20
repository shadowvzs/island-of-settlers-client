import { expect, it } from "vitest";

import { shipPortrait } from "../src/app/settlement-ui/ship-register/ship-portrait";

it("uses all four canonical neutral hull portraits independently of the player nation", () => {
  for (const nation of ["roman", "viking", "japanese", "nubian"] as const) {
    const portrait = shipPortrait({ id: "1", name: "Visitor", status: "sailing", owned: false, nation, livery: "neutral" }, "roman");
    expect(portrait).toMatchObject({ kind: "image", source: expect.stringContaining(`neutral-${nation}.png`) });
  }
});

it("keeps player portraits national and owned instead of borrowing visitor livery", () => {
  for (const nation of ["roman", "viking", "japanese", "nubian"] as const) {
    const portrait = shipPortrait({ id: "1", name: "Player", status: "idle", owned: true }, nation);
    expect(portrait.kind).toBe("image");
    if (portrait.kind === "image") expect(portrait.source).not.toContain("neutral-");
  }
});
