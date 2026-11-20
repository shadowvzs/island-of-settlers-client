import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";

/**
 * Captures the campaign mode of `editor.html` (lanes C6, REWARD-PICKER): it authors one campaign through the real UI (dialogs,
 * uploads, node drags), then shoots every tab at desktop and phone width, English and Hungarian.
 * Run: npx tsx --env-file=<file with OUT=<folder>> tools/bench/campaign-editor-review.ts
 */
const DESKTOP = { height: 860, width: 1366 };
const PHONE = { height: 844, width: 390 };
const SETTLE_MS = 350;
const ASSETS = resolve(import.meta.dirname, "../../src/app/assets");
const PORTRAITS = resolve(import.meta.dirname, "../../assets/commander-portraits");
const MAP_IMAGE = join(ASSETS, "island-voyage-2.webp");
const STORY_IMAGE = join(ASSETS, "island-voyage-1.webp");

const out = process.env.OUT ?? "/tmp/campaign-editor-review";
mkdirSync(out, { recursive: true });

const answers: string[] = [];
const settle = (page: Page) => page.waitForTimeout(SETTLE_MS);
const tab = (page: Page, name: RegExp) => page.getByRole("tab", { name }).click();
const button = (page: Page, name: string | RegExp) => page.getByRole("button", { exact: typeof name === "string",
  name }).first().click();

const visibleThumbnails = (page: Page) => page.locator("[role=tabpanel]:not([hidden]) .campaign-editor__thumbnail img");

const shoot = async (page: Page, name: string) => {
  await settle(page);
  const overflow = await page.evaluate(() => [document.getElementById("campaign-editor"),
    document.querySelector(".map-editor")].some(host => host && host.scrollWidth > host.clientWidth + 1));
  await page.screenshot({ path: join(out, `${name}.png`) });
  console.log(`${name}${overflow ? " (horizontal overflow!)" : ""}`);
};

const translate = async (page: Page, field: string, hungarian: string) => {
  await page.getByRole("button", { name: `Translations of ${field}` }).first().click();
  await page.getByRole("group", { name: `Translations of ${field}` }).getByLabel("Magyar").fill(hungarian);
};

const dragNode = async (page: Page, position: number, u: number, v: number) => {
  const frame = await page.locator(".campaign-editor__map-view").boundingBox();
  const node = await page.getByRole("button", { name: new RegExp(`^Map ${position}:`) }).boundingBox();
  if (!frame || !node) throw new Error("map view not visible");
  await page.mouse.move(node.x + node.width / 2, node.y + node.height / 2);
  await page.mouse.down();
  await page.mouse.move(frame.x + frame.width * u, frame.y + frame.height * v, { steps: 8 });
  await page.mouse.up();
};

const picker = (page: Page) => page.getByRole("region", { name: "Choose rewards" });
const pickerTab = (page: Page, name: RegExp) => picker(page).getByRole("tab", { name }).click();
const pickerPanel = (page: Page) => picker(page).locator("[role=tabpanel]:not([hidden])");
const pickOption = (page: Page, name: string) =>
  pickerPanel(page).getByRole("button", { exact: true, name }).click();

/** The map rewards through the reward picker: misc amounts, two wares, people and two catalog decorations. */
const authorRewards = async (page: Page) => {
  await pickerTab(page, /^Misc/);
  await pickOption(page, "Gold coins");
  await pickOption(page, "Experience (XP)");
  await pickOption(page, "Gems");
  await page.getByLabel("Amount of Gold coins").fill("400");
  await page.getByLabel("Amount of Experience (XP)").fill("50000");
  await page.getByLabel("Amount of Gems").fill("12");
  await pickerTab(page, /^Wares/);
  await pickOption(page, "Softwood planks");
  await pickOption(page, "Stone");
  await page.getByLabel("Amount of Softwood planks").fill("30");
  await pickerTab(page, /^People/);
  await pickOption(page, "Settlers");
  await pickerPanel(page).getByRole("button").nth(3).click();
  await page.getByLabel("Amount of Settlers").fill("6");
  await pickerTab(page, /^Decorations/);
  await pickerPanel(page).getByRole("button").nth(0).click();
  await pickerPanel(page).getByRole("button").nth(5).click();
};

/** Each picker tab, a Hungarian-name search and the filled list; then both delete confirmations. */
const shootRewardPicker = async (page: Page, suffix: string) => {
  await tab(page, /^Maps$/);
  await page.getByRole("button", { exact: true, name: "Landfall at Grey Cove" }).click();
  for (const [name, file] of [[/^Wares/, "wares"], [/^People/, "people"], [/^Decorations/, "decorations"],
    [/^Misc/, "misc"]] as const) {
    await pickerTab(page, name);
    await picker(page).scrollIntoViewIfNeeded();
    await shoot(page, `picker-${file}-${suffix}`);
  }
  await picker(page).getByRole("searchbox").fill("deszka");
  await pickerTab(page, /^Wares/);
  await shoot(page, `picker-search-hu-name-${suffix}`);
  await picker(page).getByRole("searchbox").fill("");
  await page.getByRole("heading", { name: "Selected rewards" }).scrollIntoViewIfNeeded();
  await shoot(page, `picker-selected-list-${suffix}`);
  await page.getByRole("tabpanel").getByRole("button", { exact: true, name: "Delete map" }).click();
  await shoot(page, `confirm-delete-map-${suffix}`);
  await button(page, "Cancel");
  await page.getByRole("navigation").getByRole("button", { exact: true, name: "Delete" }).last().click();
  await shoot(page, `confirm-delete-campaign-${suffix}`);
  await page.keyboard.press("Escape");
};

/** Authors the review campaign: metadata, image, three maps with rewards, nodes, story and one speaker. */
const authorCampaign = async (page: Page) => {
  answers.push("The Northern Isles");
  await button(page, "New campaign");
  await page.getByText("Uploads are our own or licence-clean artwork").click();
  await page.getByLabel("Name", { exact: true }).first().fill("The Northern Isles");
  await translate(page, "Name", "Az északi szigetek");
  await page.getByLabel("Description").first().fill("Three landings on the cold northern coast.\nWinter comes early.");
  await page.getByLabel("Available from (UTC date)").fill("2026-12-01");
  await page.getByLabel("Available until (UTC date, inclusive)").fill("2027-02-28");
  await page.getByLabel("Upload image: Campaign map").setInputFiles(MAP_IMAGE);
  await visibleThumbnails(page).first().waitFor();
  await tab(page, /^Maps$/);
  for (let index = 0; index < 3; index++) await button(page, "Add map");
  await page.getByRole("button", { exact: true, name: "Map 1" }).click();
  await page.getByLabel("Name", { exact: true }).last().fill("Landfall at Grey Cove");
  await page.getByLabel("Minimum player level (0: none)").fill("12");
  await authorRewards(page);
  await button(page, "Save");
};

const authorMapView = async (page: Page) => {
  await tab(page, /^Campaign map$/);
  await dragNode(page, 1, 0.18, 0.72);
  await dragNode(page, 2, 0.5, 0.42);
  await dragNode(page, 3, 0.8, 0.25);
};

const authorStory = async (page: Page) => {
  await tab(page, /^Story$/);
  const intro = page.getByRole("region", { name: "Intro (map start)" });
  await intro.getByLabel("Title", { exact: true }).fill("Grey Cove");
  await intro.getByLabel("Text", { exact: true }).fill(
    "The fog lifts over Grey Cove. Our ships ride at anchor while the scouts row ashore.\n" +
    "Build a foothold before the northern clans notice us.");
  await intro.getByLabel("Upload image: Story image").setInputFiles(STORY_IMAGE);
  await intro.locator(".campaign-editor__thumbnail img").waitFor();
};

const authorSpeaker = async (page: Page) => {
  await tab(page, /^Speakers$/);
  await page.getByLabel("Upload image: Add speaker (choose its portrait)").setInputFiles(join(PORTRAITS, "roman.png"));
  const speaker = page.locator(".campaign-editor__speaker").first();
  await speaker.waitFor();
  await speaker.getByLabel("Name", { exact: true }).fill("Advisor Livia");
  await speaker.getByLabel("Upload image: Worried").setInputFiles(join(PORTRAITS, "viking.png"));
  await speaker.locator(".campaign-editor__thumbnail img").nth(1).waitFor();
};

const shootTabs = async (page: Page, suffix: string) => {
  await tab(page, /^Details$/);
  await page.getByRole("button", { name: "Translations of Name" }).first().click();
  await shoot(page, `details-translations-${suffix}`);
  await page.getByRole("button", { name: "Translations of Name" }).first().click();
  await tab(page, /^Maps$/);
  await page.getByRole("button", { exact: true, name: "Landfall at Grey Cove" }).click();
  await shoot(page, `map-list-${suffix}`);
  await page.getByLabel("Minimum player level (0: none)").scrollIntoViewIfNeeded();
  await shoot(page, `selected-map-card-${suffix}`);
  await tab(page, /^Campaign map$/);
  await shoot(page, `map-view-${suffix}`);
  await tab(page, /^Story$/);
  await shoot(page, `story-form-${suffix}`);
  await page.getByRole("region", { name: "Intro (map start)" }).getByRole("button", { name: "Preview" }).click();
  await shoot(page, `story-preview-${suffix}`);
  await page.locator(".story-panel button").first().click();
  await tab(page, /^Speakers$/);
  await shoot(page, `speakers-${suffix}`);
  await tab(page, /^Ready check$/);
  await shoot(page, `validation-${suffix}`);
};

/** Map editor tabs with number fields; the first field scrolled into view (Units switches to an adventure). */
const MAP_EDITOR_PANELS = [["Units and camps", "units"], ["Stone, marble and mine deposits", "deposits"],
  ["Plants and decorations", "objects"], ["Relief and water", "terrain"]] as const;

const shootMapEditorPanels = async (page: Page, suffix: string) => {
  for (const [name, file] of MAP_EDITOR_PANELS) {
    await page.getByRole("tab", { name }).click();
    const adventure = page.getByRole("button").filter({ hasText: /^Switch to adventure$/ });
    if (await adventure.waitFor({ timeout: 2_000 }).then(() => true, () => false)) await adventure.click();
    await page.locator(".map-editor__tab-panel:not([hidden]) input[type=number]").first().scrollIntoViewIfNeeded();
    await shoot(page, `map-editor-${file}-${suffix}`);
  }
};

const waitForEditor = (page: Page) => page.waitForFunction(
  () => Boolean((window as Window & { __editorReady?: boolean }).__editorReady), null, { timeout: 180_000 });

/** "Open map" into the 3D map editor on the campaign slot, Save there, back to the campaign, then map Ready. */
const openMapRoundTrip = async (page: Page) => {
  await tab(page, /^Maps$/);
  await page.getByRole("button", { exact: true, name: "Landfall at Grey Cove" }).click();
  await button(page, "Open map");
  await page.waitForURL(/campaignSlot=/);
  await waitForEditor(page);
  await page.getByRole("tab", { name: "Map, headquarters and scenario" }).click();
  const note = page.getByText(/^Campaign map: Save stores it/);
  await note.scrollIntoViewIfNeeded();
  await button(page, "Save campaign map");
  await page.getByText(/^Campaign map "Landfall at Grey Cove" saved|^Campaign map ".*" saved/).first().waitFor();
  await shoot(page, "map-editor-campaign-slot-desktop");
  await shootMapEditorPanels(page, "desktop");
  await page.setViewportSize(PHONE);
  await shootMapEditorPanels(page, "phone");
  await page.setViewportSize(DESKTOP);
  await page.getByRole("tab", { name: "Map, headquarters and scenario" }).click();
  await button(page, "Back to the campaign editor");
  await page.waitForURL(/mode=campaign/);
  await waitForEditor(page);
  await tab(page, /^Maps$/);
  await page.getByRole("tabpanel").getByRole("button", { exact: true, name: "Save as Ready" }).click();
  await tab(page, /^Ready check$/);
  await shoot(page, "validation-map-desktop");
};

const { server, url } = await startDevServer();
const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: DESKTOP });
  page.on("pageerror", error => console.error("[pageerror]", error.message));
  page.on("dialog", dialog => void dialog.accept(dialog.type() === "prompt" ? answers.shift() ?? "" : undefined));
  await page.goto(`${url}editor.html?mode=campaign`);
  await page.waitForFunction(() => Boolean((window as Window & { __editorReady?: boolean }).__editorReady));
  await shoot(page, "list-empty-desktop");
  answers.push("Summer festival (event)");
  await button(page, "New campaign");
  await authorCampaign(page);
  await authorMapView(page);
  await authorStory(page);
  await authorSpeaker(page);
  await button(page, "Save");
  await button(page, "Save as Ready");
  await shoot(page, "list-ready-attempt-desktop");
  await shootTabs(page, "desktop");
  await shootRewardPicker(page, "desktop");
  await page.setViewportSize(PHONE);
  await shootTabs(page, "phone");
  await shootRewardPicker(page, "phone");
  await page.setViewportSize(DESKTOP);
  await openMapRoundTrip(page);
  await page.evaluate(() => localStorage.setItem("island-of-settlers.language", "hu"));
  await page.reload();
  await page.waitForFunction(() => Boolean((window as Window & { __editorReady?: boolean }).__editorReady));
  await page.getByRole("button", { name: /The Northern Isles|Az északi szigetek/ }).first().click();
  await settle(page);
  await shoot(page, "details-phone-hu");
  await page.setViewportSize(DESKTOP);
  await page.getByRole("tab").nth(2).click();
  await shoot(page, "map-view-desktop-hu");
  await page.locator("#campaign-editor-tab-validation").click();
  await page.locator(".campaign-check__run").click();
  await shoot(page, "validation-desktop-hu");
} catch (error) {
  const page = browser.contexts()[0]?.pages()[0];
  if (page) {
    await page.screenshot({ fullPage: true, path: join(out, "failure.png") });
    console.error(await page.locator(".reward-picker").first().innerHTML().catch(() => "no picker"));
  }
  throw error;
} finally {
  await browser.close();
  await server.close();
}
