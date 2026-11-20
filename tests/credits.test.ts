import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { createDefaultPolicy } from "../src/app/components/lazy-react-window";
import {
  CREDIT_CATEGORIES,
  CREDIT_LICENCES,
  describeLicence,
  GAME_CREATOR,
  getAttributionText,
  ORIGINAL_WORK,
  requiresAttribution
} from "../src/app/settings/credits-data";
import { renderCreditsMarkdown } from "../tools/assets/credits-markdown";

const root = resolve(import.meta.dirname, "..");
const entries = CREDIT_CATEGORIES.flatMap((category) => category.entries);

/** Every LICENSE.txt under assets/models (each shipped third-party model folder has one). */
const findLicenceFiles = (folder: string): string[] =>
  readdirSync(folder, { withFileTypes: true }).flatMap((item) => {
    const path = join(folder, item.name);
    if (item.isDirectory()) return findLicenceFiles(path);
    return item.name === "LICENSE.txt" ? [path] : [];
  });

describe("credits data", () => {
  it("names the owner as the creator", () => {
    expect(GAME_CREATOR).toEqual({ name: "shadowvzs", role: "Game design and development" });
  });

  it("keeps CREDITS.md generated from the data (run npm run credits)", () => {
    expect(readFileSync(resolve(root, "CREDITS.md"), "utf8")).toBe(renderCreditsMarkdown());
  });

  it("credits every source named in a shipped model's LICENSE.txt", () => {
    const sources = new Set(entries.map((entry) => entry.sourceUrl));
    const licenceFiles = findLicenceFiles(resolve(root, "assets/models"));
    expect(licenceFiles.length).toBeGreaterThan(0);
    for (const file of licenceFiles) {
      const urls = readFileSync(file, "utf8").match(/Source: (\S+)/g) ?? [];
      for (const url of urls) expect(sources, file).toContain(url.slice("Source: ".length));
    }
  });

  it("gives every CC BY entry the full attribution text", () => {
    const attributed = entries.filter(requiresAttribution);
    expect(attributed.length).toBeGreaterThanOrEqual(9);
    for (const entry of attributed) {
      const text = getAttributionText(entry);
      expect(entry.changes, entry.title).toBeTruthy();
      expect(text).toContain(`"${entry.title}" by ${entry.author}`);
      expect(text).toContain(entry.sourceUrl!);
      expect(text).toContain(CREDIT_LICENCES["cc-by-4.0"].url!);
      expect(text).toContain(entry.changes!);
    }
  });

  it("links only over https and has unique titles per category", () => {
    for (const category of CREDIT_CATEGORIES) {
      const titles = category.entries.map((entry) => entry.title);
      expect(new Set(titles).size, category.id).toBe(titles.length);
    }
    const urls = entries.flatMap((entry) => [entry.sourceUrl, entry.authorUrl]).filter(Boolean);
    for (const url of urls) expect(url).toMatch(/^https:\/\//);
  });

  it("marks original assets as original work for Island of Settlers", () => {
    const originals = entries.filter((entry) => entry.licence === "original");
    expect(originals.length).toBeGreaterThan(0);
    for (const entry of originals) expect(describeLicence(entry)).toBe(ORIGINAL_WORK);
    expect(ORIGINAL_WORK).toBe("original work for Island of Settlers");
  });

  it("labels the worker and horse characters Owner-owned (Tripo3D)", () => {
    const workers = entries.find((entry) => entry.title === "Worker and horse characters")!;
    expect(describeLicence(workers)).toBe("Owner-owned (Tripo3D)");
    expect(renderCreditsMarkdown()).toContain("| Owner-owned (Tripo3D) |");
  });

  it("ends with the build tools as the last Tools group", () => {
    const tools = CREDIT_CATEGORIES.at(-1)!;
    expect(tools.title).toBe("Tools");
    expect(tools.entries.map((entry) => entry.title)).toEqual(
      ["Blender", "glTF Transform", "Vite", "TypeScript", "Vitest", "Playwright"]);
  });

  it("lists three.js with its MIT licence and no removed tree previews", () => {
    const three = entries.find((entry) => entry.title === "three.js");
    expect(three?.licence).toBe("mit");
    expect(JSON.stringify(CREDIT_CATEGORIES)).not.toMatch(/tree-previews/);
  });
});

describe("default window policy (Credits)", () => {
  const createView = () => ({ hide: vi.fn(), restoreFocus: vi.fn(), show: vi.fn() });

  it("reshows when opened again and closes back to the opener once", () => {
    const view = createView();
    const state = createDefaultPolicy(view);
    state.open();
    state.open();
    expect(view.show).toHaveBeenCalledTimes(2);
    state.close();
    state.close();
    expect(view.hide).toHaveBeenCalledTimes(1);
    expect(view.restoreFocus).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape only while open", () => {
    const view = createView();
    const state = createDefaultPolicy(view);
    expect(state.handleKey("Escape")).toBe(false);
    state.open();
    expect(state.handleKey("Enter")).toBe(false);
    expect(state.handleKey("Escape")).toBe(true);
    expect(state.handleKey("Escape")).toBe(false);
    expect(view.restoreFocus).toHaveBeenCalledTimes(1);
  });
});
