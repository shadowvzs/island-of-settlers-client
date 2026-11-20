import { closeDevelopment, openDevelopmentAction } from "./development-ui-helpers";

type Page = import("playwright-core").Page;

/** Shared steps of the native expedition reviews (test buttons, voyages, island visits, popups). */
export const waitForIsland = async (page: Page) => {
  await page.waitForFunction(() => Boolean((window as any).__islandReady), null, { timeout: 600000 });
  await page.locator("#loading-screen").waitFor({ state: "detached", timeout: 600000 });
};

/** Clicks something that reloads the page into another island and waits until it is ready. */
export const reloadIsland = async (page: Page, click: () => Promise<unknown>) => {
  await Promise.all([page.waitForEvent("load", { timeout: 120000 }), click()]);
  await waitForIsland(page);
};

export const lookAt = (page: Page, point: { x: number; z: number }) =>
  page.evaluate(({ x, z }) => (window as any).__settlement.focusGround(x, z), point);

export const statusMessages = (page: Page) => page.evaluate(() =>
  [...document.querySelectorAll(".settlement-ui__status")]
    .map(node => node.textContent?.trim()).filter(Boolean));

/** Game seconds in fixed steps until the expedition has landed. */
export const sailUntilLanded = (page: Page) => page.evaluate(async () => {
  const simulation = (window as any).__settlement.simulation;
  let second = 0;
  for (; second < 3000 && simulation.colonyExpeditions().at(-1)?.status !== "arrived"; second++) {
    simulation.update(1);
    if (second % 10 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  const expedition = simulation.colonyExpeditions().at(-1);
  return { island: expedition?.island, seconds: second, status: expedition?.status };
});

/** Development tools > the named test button; `shot` captures the open menu and the result. */
export const runDevelopmentTool = async (page: Page, name: string, shot: (suffix: string) => Promise<void>) => {
  const tool = await openDevelopmentAction(page, name);
  await shot("-menu");
  await tool.click();
  await closeDevelopment(page);
  await shot("");
  return statusMessages(page);
};

/** Opens the colonies list if needed and clicks the island's visit button. */
export const visitIsland = async (page: Page, selector: string) => {
  await page.waitForFunction(() => (window as any).__settlement.simulation.colonyExpeditions()
    .some((expedition: any) => expedition.status === "arrived"), null, { timeout: 120000 });
  const visit = page.locator(selector).first();
  if (!await visit.isVisible()) await page.locator("[aria-label^='Colonies'], [title^='Colonies']").first().click();
  await visit.waitFor({ state: "visible", timeout: 10000 });
  await reloadIsland(page, () => visit.click());
};

/** The open result popup, its text and the named button. */
export const openPopup = async (page: Page, button: string) => {
  const popup = page.locator(".settlement-popup__dialog");
  await popup.waitFor({ state: "visible", timeout: 20000 });
  return { popup, text: await popup.innerText(), button: popup.getByRole("button", { exact: true, name: button }) };
};

/**
 * A worktree without three's Basis transcoder in its own node_modules gets index.html for it; that
 * environment gap (and the parse error it causes) is not a game error.
 */
export const gameErrors = (errors: readonly string[]) => errors.some(error => error.includes("basis_transcoder"))
  ? errors.filter(error => !error.includes("basis_transcoder") && !error.includes("Unexpected identifier 'html'"))
  : errors;

/** Records page errors and HTML served for scripts, each tagged with the review step. */
export const trackPageErrors = (page: Page, stage: () => string) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(`${stage()}: ${error.message}`));
  page.on("response", response => {
    const type = response.headers()["content-type"] ?? "";
    if (type.includes("html") && ["script", "fetch", "xhr", "other"].includes(response.request().resourceType()))
      errors.push(`${stage()}: HTML for ${response.request().resourceType()} ${response.url()}`);
  });
  return errors;
};

/** A fresh seed-123 island at the given detail, ready to play. */
export const openFreshIsland = async (page: Page, url: string, quality: string) => {
  await page.addInitScript("window.__name=value=>value;");
  await page.routeWebSocket("**/*", () => {});
  await page.goto(`${url}?quality=${quality}&seed=123&size=128&mountains=0&forest=0&cache=0`);
  await waitForIsland(page);
};
