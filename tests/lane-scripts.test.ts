import { describe, expect, it } from "vitest";

import {
  forbiddenDiffEntries, formatTouchPoints, groupListedTests, isLocaleFile, isSameOrInside, isStrictlyInside,
  laneNameError, mountPointFor, needsVerifierRebuild, overlappingPaths, parseMergeTreeConflicts,
  parseMountPoints, parsePorcelainZ, parseRawDiffZ, parseWorktreeList, throttledTestCommand, withoutHelperLinks
} from "../../scripts/lanes/lane-helpers.ts";

// TOOL-6: the pure guards and parsers of scripts/lanes (worktree create/remove/merge-check).
const ROOT = "/media/drive/worktree";

describe("lane name and path guards", () => {
  it("accepts plain lane names and refuses traversal, slashes and reserved folders", () => {
    expect(laneNameError("tools-lane-selftest")).toBeUndefined();
    for (const bad of [undefined, "", "../x", "a/b", "..", ".hidden", "Upper", "captures", "resources", "a..b"]) {
      expect(laneNameError(bad)).toBeTypeOf("string");
    }
  });

  it("keeps paths strictly inside the root", () => {
    expect(isStrictlyInside(`${ROOT}/lane`, ROOT)).toBe(true);
    expect(isStrictlyInside(`${ROOT}/lane/a/b`, ROOT)).toBe(true);
    expect(isStrictlyInside(ROOT, ROOT)).toBe(false);
    expect(isStrictlyInside(`${ROOT}/../other`, ROOT)).toBe(false);
    expect(isStrictlyInside(`${ROOT}-sibling/lane`, ROOT)).toBe(false);
    expect(isStrictlyInside("relative/lane", ROOT)).toBe(false);
    expect(isSameOrInside(ROOT, ROOT)).toBe(true);
  });

  it("finds the mount point holding the lane root, decoding escaped spaces", () => {
    const mounts = parseMountPoints("/dev/sda2 / ext4 rw 0 0\n/dev/sdb1 /media/drive ext4 rw 0 0\n"
      + "/dev/sdc1 /media/my\\040disk ext4 rw 0 0\n");
    expect(mounts).toEqual(["/", "/media/drive", "/media/my disk"]);
    expect(mountPointFor(ROOT, mounts)).toBe("/media/drive");
    expect(mountPointFor("/media/my disk/x", mounts)).toBe("/media/my disk");
    expect(mountPointFor("/media/driveX/worktree", mounts)).toBe("/");
  });
});

describe("git output parsers", () => {
  it("parses worktree porcelain blocks", () => {
    const list = parseWorktreeList("worktree /game\nHEAD abc\nbranch refs/heads/master\n\n"
      + `worktree ${ROOT}/a\nHEAD def\nbranch refs/heads/lane/a\nlocked reason\n\n`
      + `worktree ${ROOT}/b\nHEAD 123\ndetached\n`);
    expect(list).toEqual([
      { branch: "master", detached: false, head: "abc", locked: false, path: "/game" },
      { branch: "lane/a", detached: false, head: "def", locked: true, path: `${ROOT}/a` },
      { branch: undefined, detached: true, head: "123", locked: false, path: `${ROOT}/b` }
    ]);
  });

  it("flags added symlinks and helper paths but not deletions or ordinary files", () => {
    const raw = [
      ":000000 120000 0000000 1111111 A", "island-of-settlers-worker-generation",
      ":100644 120000 2222222 3333333 T", "docs/link",
      ":000000 100644 0000000 4444444 A", "node_modules",
      ":120000 000000 5555555 0000000 D", "old-link",
      ":100644 100644 6666666 7777777 M", "src/a.ts", ""
    ].join("\0");
    const entries = parseRawDiffZ(raw);
    expect(entries.map((entry) => entry.path)).toEqual([
      "island-of-settlers-worker-generation", "docs/link", "node_modules", "old-link", "src/a.ts"
    ]);
    expect(forbiddenDiffEntries(entries)).toEqual([
      "island-of-settlers-worker-generation (mode 000000 -> 120000)", "docs/link (mode 100644 -> 120000)",
      "node_modules (mode 000000 -> 100644)"
    ]);
  });

  it("reads porcelain -z paths including both sides of renames", () => {
    const porcelain = [" M src/a.ts", "R  new.ts", "old.ts", "?? docs/n.md", ""].join("\0");
    expect(parsePorcelainZ(porcelain)).toEqual(["src/a.ts", "new.ts", "old.ts", "docs/n.md"]);
  });

  it("lists merge-tree conflicts after the tree id", () => {
    expect(parseMergeTreeConflicts("abc123\nb.ts\na.ts\nb.ts\n")).toEqual(["a.ts", "b.ts"]);
    expect(parseMergeTreeConflicts("abc123\n")).toEqual([]);
  });
});

describe("merge-check classifiers", () => {
  it("intersects lane changes with dirty main-checkout files and drops helper links", () => {
    expect(overlappingPaths(["b.ts", "a.ts", "c.ts"], ["c.ts", "a.ts", "z.ts"])).toEqual(["a.ts", "c.ts"]);
    expect(withoutHelperLinks(["node_modules", "resources-readonly/", "src/x.ts"])).toEqual(["src/x.ts"]);
  });

  it("detects locale, verifier and format touch points", () => {
    expect(isLocaleFile("island-of-settlers-client/src/locales/hu/messages.po")).toBe(true);
    expect(isLocaleFile("island-of-settlers-client/src/locales/hu/other.ts")).toBe(false);
    expect(needsVerifierRebuild(["docs/todo.md", "island-of-settlers-client/tests/a.test.ts"])).toBe(false);
    expect(needsVerifierRebuild(["island-of-settlers-shared/src/formats.ts"])).toBe(true);
    expect(formatTouchPoints(
      ["island-of-settlers-shared/src/commands/command-manifest.ts", "src/x.ts"], ["src/save.ts"]
    )).toEqual(["island-of-settlers-shared/src/commands/command-manifest.ts", "src/save.ts (SETTLEMENT_SAVE_VERSION)"]);
  });

  it("groups vitest list output into unit and slow client-relative files", () => {
    const json = `noise\n${JSON.stringify([
      { file: "/c/tests/b.test.ts", projectName: "unit" }, { file: "/c/tests/a.test.ts", projectName: "unit" },
      { file: "/c/tests/s.slow.test.ts", projectName: "slow" }
    ])}`;
    expect(groupListedTests(json, "/c")).toEqual({
      slow: ["tests/s.slow.test.ts"], unit: ["tests/a.test.ts", "tests/b.test.ts"]
    });
    expect(groupListedTests("[]", "/c")).toEqual({ slow: [], unit: [] });
    expect(throttledTestCommand(["tests/a.test.ts"])).toBe(
      "nice -n 15 npx tsx node_modules/vitest/vitest.mjs run tests/a.test.ts --maxWorkers=2 --no-file-parallelism"
    );
  });
});
