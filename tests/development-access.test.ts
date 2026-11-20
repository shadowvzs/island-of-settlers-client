import { describe, expect, it } from "vitest";

import { resolveDevelopmentAccess } from "../src/app/development-access";

describe("development access", () => {
  it("allows signed-in administrators only", () => {
    expect(resolveDevelopmentAccess({ devBuild: false, online: true, role: "admin" }))
      .toEqual({ allowed: true, reason: "admin" });
    for (const role of ["player", "moderator", null, undefined, "ADMIN"])
      expect(resolveDevelopmentAccess({ devBuild: true, online: true, role }))
        .toEqual({ allowed: false, reason: "signed-in-player" });
  });

  it("keeps guest debug tools in development builds and removes them from production", () => {
    expect(resolveDevelopmentAccess({ devBuild: true, online: false }))
      .toEqual({ allowed: true, reason: "guest-dev-build" });
    expect(resolveDevelopmentAccess({ devBuild: false, online: false }))
      .toEqual({ allowed: false, reason: "guest-production" });
  });

});
