import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  AUDIT_SCOPE,
  collectModuleSizes,
  parseAuditArguments,
  writeUniqueReceipt
} from "../tools/analysis/project-audit";

const temporaryFolders: string[] = [];
const temporaryFolder = () => {
  const folder = mkdtempSync(join(tmpdir(), "project-audit-"));
  temporaryFolders.push(folder);
  return folder;
};

afterEach(() => {
  for (const folder of temporaryFolders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe("project audit arguments", () => {
  it("accepts an explicit output, date and dry run", () => {
    expect(parseAuditArguments(["--output", "audit-output", "--date=2026-10-23", "--dry-run"]))
      .toEqual({ date: "2026-10-23", dryRun: true, help: false, output: "audit-output" });
  });

  it("rejects unknown flags and invalid dates instead of silently using the old receipt", () => {
    expect(() => parseAuditArguments(["--force"])).toThrow("Unknown argument: --force");
    expect(() => parseAuditArguments(["--date", "2026-02-30"])).toThrow("Invalid --date");
    expect(() => parseAuditArguments(["--output"])).toThrow("--output requires a value");
  });
});

describe("project audit output", () => {
  it("never overwrites an existing receipt", () => {
    const folder = temporaryFolder();
    const first = writeUniqueReceipt(folder, { run: 1 });
    const second = writeUniqueReceipt(folder, { run: 2 });
    expect(first.endsWith("structure-audit.json")).toBe(true);
    expect(second.endsWith("structure-audit-2.json")).toBe(true);
    expect(JSON.parse(readFileSync(first, "utf8"))).toEqual({ run: 1 });
    expect(JSON.parse(readFileSync(second, "utf8"))).toEqual({ run: 2 });
  });

  it("includes TSX in the module size scan and labels the scope", () => {
    const folder = temporaryFolder();
    mkdirSync(join(folder, "src"));
    writeFileSync(join(folder, "src", "legacy.ts"), "one\ntwo\n");
    writeFileSync(join(folder, "src", "component.tsx"), "one\ntwo\nthree\n");
    writeFileSync(join(folder, "src", "ignored.js"), "one\n");
    expect(collectModuleSizes(folder)).toEqual([
      { file: "src/component.tsx", lines: 3 },
      { file: "src/legacy.ts", lines: 2 }
    ]);
    expect(AUDIT_SCOPE.moduleSize.included).toEqual([".ts", ".tsx"]);
    expect(AUDIT_SCOPE.moduleSize.roots).toEqual(["island-of-settlers-client/src"]);
    expect(AUDIT_SCOPE.moduleSize.caution).toContain("not a defect");
  });
});
