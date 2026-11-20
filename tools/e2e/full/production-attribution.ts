import type { Page } from "playwright-core";

/** Browser-local sampler shared by natural and catalog production acceptance. */
export const startProductionAttribution = (page: Page, uid: number, outputs: string[], typeId: number) =>
  page.evaluate(async ({ outputs, typeId, uid }) => {
    const prior = (window as any).__productionAttribution;
    if (prior) throw new Error("A production observer is already active; stop it before starting another");
    const url = "/tools/e2e/full/production-attribution-observer.ts";
    const { createProductionAttributionObserver } = await import(/* @vite-ignore */ url);
    (window as any).__productionAttribution = createProductionAttributionObserver(
      (window as any).__settlement.simulation, uid, outputs, typeId
    );
  }, { uid, outputs, typeId });

export const readProductionAttribution = (page: Page) =>
  page.evaluate(() => (window as any).__productionAttribution.read());

export const stopProductionAttribution = (page: Page) => page.evaluate(() => {
  (window as any).__productionAttribution?.stop();
  delete (window as any).__productionAttribution;
});
