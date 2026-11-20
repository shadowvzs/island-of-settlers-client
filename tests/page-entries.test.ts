import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  DEV_ONLY_PAGES,
  isDevOnlyPage,
  isLoopbackPeer,
  PRODUCTION_ENTRIES
} from "../tools/page-entries";

const html = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

describe("production page entries and dev-only surfaces", () => {
  it("ships the player, administrator page and authenticated editor only", () => {
    expect(PRODUCTION_ENTRIES).toEqual({
      admin: "admin.html",
      editor: "editor.html",
      main: "index.html"
    });
    expect(PRODUCTION_ENTRIES.main).not.toBe(PRODUCTION_ENTRIES.admin);
    expect(html("index.html")).toContain('src="/src/app/main.ts"');
    expect(html("index.html")).not.toContain("admin-main");
    expect(html("admin.html")).toContain('src="/src/app/admin-main.ts"');
    expect(html("admin.html")).not.toContain("/src/app/main.ts");
    expect(html("editor.html")).toContain('src="/src/app/editor-main.ts"');
  });

  it("recognizes the dev-only pages regardless of query/hash", () => {
    for (const page of DEV_ONLY_PAGES) {
      expect(isDevOnlyPage(`/${page}`)).toBe(true);
      expect(isDevOnlyPage(`/${page}?quality=high#view`)).toBe(true);
    }
    expect(isDevOnlyPage("/index.html")).toBe(false);
    expect(isDevOnlyPage("/admin.html")).toBe(false);
    expect(isDevOnlyPage("/editor.html")).toBe(false);
    expect(isDevOnlyPage(undefined)).toBe(false);
  });

  it("allows dev-only pages only from a loopback socket peer", () => {
    for (const address of ["127.0.0.1", "127.0.0.2", "::1", "::ffff:127.0.0.1", "::ffff:7f00:1"])
      expect(isLoopbackPeer(address)).toBe(true);
    for (const address of [undefined, "192.168.1.20", "10.0.0.4", "::ffff:192.168.1.20"])
      expect(isLoopbackPeer(address)).toBe(false);
  });
});
