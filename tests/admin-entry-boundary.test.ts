import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (file: string) =>
  readFileSync(new URL(`../src/app/${file}`, import.meta.url), "utf8");

describe("admin/local-dev boundary", () => {
  it("keeps the player entry free of admin and dev modules", () => {
    const main = source("main.ts");
    expect(main).not.toContain("admin-modules");
    expect(main).not.toContain("dev-params");
    expect(main).not.toContain("scene-replay");
    expect(main).not.toContain("island-development-tools");
    expect(main).not.toContain("./admin/");
    // The entry stays small: the boot session and the island graph are dynamic imports.
    expect(main).not.toMatch(/from "\.\/(game-boot|session-boot)"/);
    expect(main).toContain('import("./session-boot")');
    expect(main).toContain('import("./game-boot")');
  });

  it("loads admin modules only through the admin page's lazy loader", () => {
    const session = source("session-boot.ts");
    expect(session).toContain('import type { LoadAdminModules } from "./admin-modules"');
    expect(session).toContain("await admin.load()");
    for (const boot of [session, source("game-boot.ts")])
      expect(boot).not.toMatch(/from "\.\/(island-development-tools|dev-params|scene-replay)/);
    const admin = source("admin-main.ts");
    expect(admin).not.toContain('import { loadAdminModules } from "./admin-modules"');
    expect(admin).toContain('import("./admin-modules")');
    expect(admin).toContain('import("./admin/mount-admin-window")');
    expect(source("editor-main.ts")).toContain('import("./admin-modules")');
    expect(source("editor-main.ts")).not.toContain('import { loadAdminModules }');
  });

  it("keeps debug factories out of the runtime's static graph", () => {
    const runtime = source("island-runtime.ts");
    expect(runtime).not.toContain('from "./island-development-tools"');
    expect(runtime).not.toContain('from "./scene-replay/runtime"');
    expect(runtime).toContain("developmentModules?.createIslandDevelopmentTools");
    expect(runtime).toContain("developmentModules?.createSceneReplayRuntime");
  });
});
