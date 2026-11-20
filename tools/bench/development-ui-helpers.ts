import type { Page } from "playwright-core";

/** Select an explicit category for non-button controls such as nation or colour. */
export const openDevelopmentCategory = async (page: Page, name: string) => {
  const close = page.getByRole("button", { name: "Close development tools panel", exact: true });
  if (!await close.isVisible())
    await page.getByRole("button", { name: "Development tools", exact: true }).click();
  const tab = page.getByRole("tablist", { name: "Development categories", exact: true })
    .getByRole("tab", { name, exact: true });
  await tab.click();
  const panelId = await tab.getAttribute("aria-controls");
  if (!panelId) throw new Error(`Development category ${name} has no panel.`);
  const panel = page.locator(`[role="tabpanel"][id="${panelId}"]`);
  await panel.waitFor({ state: "visible" });
  return panel;
};

/** Open the live category containing an action, including after a different tab was selected. */
export const openDevelopmentAction = async (page: Page, name: string) => {
  const close = page.getByRole("button", { name: "Close development tools panel", exact: true });
  if (!await close.isVisible())
    await page.getByRole("button", { name: "Development tools", exact: true }).click();
  const mounted = page.getByRole("button", { name, exact: true, includeHidden: true });
  await mounted.waitFor({ state: "attached" });
  const panelId = await mounted.evaluate(element => element.closest('[role="tabpanel"]')?.id);
  if (panelId) {
    const tab = page.getByRole("tablist", { name: "Development categories", exact: true })
      .locator(`[role="tab"][aria-controls="${panelId}"]`);
    await tab.click();
  }
  const action = page.getByRole("button", { name, exact: true });
  await action.waitFor({ state: "visible" });
  return action;
};

export const closeDevelopment = async (page: Page) => {
  const close = page.getByRole("button", { name: "Close development tools panel", exact: true });
  if (await close.isVisible()) await close.click();
};
