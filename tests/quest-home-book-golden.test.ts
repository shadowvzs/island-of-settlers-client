import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { defaultHomeQuestBook, defaultHomeScript } from "../../island-of-settlers-shared/src/script/books/index";
import { validateMapScript } from "../../island-of-settlers-shared/src/script/validate";
import { HOME_DEFAULT_BOOK_ID } from "../../island-of-settlers-shared/src/script/constants";
import { bookToTutorialQuests } from "../src/shared/quests/home-book-tutorial";

/**
 * QU8: the shipped home book is the only source of the tutorial. The frozen file hash replaces the
 * former code/data parity checks; update it only with an intentional quest-book revision.
 */
const BOOK_FILE = fileURLToPath(
  new URL("../../island-of-settlers-shared/src/script/books/home-default.json", import.meta.url));
const BOOK_SHA256 = "b50f091183c473f01351f5f830eebc92f02d91792963d74c399d8778ebc551dc";

describe("default home quest book golden", () => {
  it("keeps the frozen shipped book and its chapter/quest shape", () => {
    const book = defaultHomeQuestBook();
    expect(book).toMatchObject({ daily: "global", dailyResetUtcMinutes: 0, id: HOME_DEFAULT_BOOK_ID, revision: 1 });
    expect(book.groups).toHaveLength(30);
    expect(book.quests).toHaveLength(121);
    expect(bookToTutorialQuests(book)).toHaveLength(121);
    expect(createHash("sha256").update(readFileSync(BOOK_FILE)).digest("hex")).toBe(BOOK_SHA256);
  });

  it("is Ready on a home map without warnings", () => {
    const result = validateMapScript(defaultHomeScript(), { languages: ["en", "hu", "de"], mapKind: "home" });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});
