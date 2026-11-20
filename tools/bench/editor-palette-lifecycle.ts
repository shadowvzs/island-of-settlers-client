import assert from "node:assert/strict";

import { openDevelopmentAction } from "./development-ui-helpers";
import type { EditorSession } from "./editor-native-session";
import { resumeSavedGame, saveFromMenu } from "./save-helpers";

/** Native controllers on the map authored by the visible palette controls, after a real new Play. */
export const exerciseEditorTreeLifecycles = async (session: EditorSession) => {
  const { page } = session;
  const mapTab = page.getByRole("tab", { name: "Map, headquarters and scenario", exact: true });
  if (!await mapTab.isVisible()) await (await openDevelopmentAction(page, "Map editor")).click();
  await mapTab.click();
  const previous = await session.runtimeToken();
  await session.button("Play authored map").click();
  await page.waitForURL(/map=/, { timeout: 60000 });
  await session.waitForRuntime(previous);
  const grown = await page.evaluate(() => {
    const { growth, world } = (window as any).__editorReview;
    const sim = (window as any).__settlement.simulation;
    const ids = Object.keys(world.authoredTreeAges ?? {}).map(Number);
    if (ids.length < 9) throw new Error("The real authored palette must contain all nine tree choices");
    sim.update(.05); // Authored ages start on the first real settlement tick.
    const before = ids.map(id => ({ age: world.authoredTreeAges[id], growing: growth.isGrowing(id), id }));
    for (let tick = 0; tick < 2600; tick++) sim.update(.05);
    const after = ids.map(id => ({ grown: growth.isGrown(id), growing: growth.isGrowing(id), id }));
    const point = { x: world.props.x[ids[0]!], z: world.props.z[ids[0]!] };
    (window as any).__settlement.focusGround(point.x, point.z, 3);
    return { after, before, ids };
  });
  assert(grown.before.some(tree => tree.age === 0 && tree.growing), "authored seedlings start growing in Play");
  assert(grown.after.every(tree => tree.grown && !tree.growing), "real settlement ticks mature every authored tree");
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${session.output}/played-tree-mature.png` });
  const chopped = await page.evaluate(ids => {
    const { felling, world } = (window as any).__editorReview;
    const sim = (window as any).__settlement.simulation;
    // This explicitly starts the same public felling controller as the woodcutter hook. It does not
    // claim a naturally staffed harvesting job or award harvested logs to the settlement.
    for (const id of ids) if (!felling.fell(id)) throw new Error(`Authored tree ${id} cannot be felled`);
    for (let tick = 0; tick < 70; tick++) sim.update(.05);
    return ids.map(id => ({ id, phase: felling.getPhase(id), type: world.props.types[id] }));
  }, grown.ids);
  assert(chopped.every(tree => tree.phase === "falling"));
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${session.output}/played-tree-falling.png` });
  const removed = await page.evaluate(ids => {
    const { felling, world } = (window as any).__editorReview;
    const sim = (window as any).__settlement.simulation;
    for (let tick = 0; tick < 600; tick++) sim.update(.05);
    return { phases: ids.map(id => felling.getPhase(id)), stumps: felling.countStumps(),
      types: ids.map(id => world.props.types[id]) };
  }, grown.ids);
  assert(removed.phases.every(phase => phase === "removed"));
  assert.equal(removed.stumps, 0, "harvested props leave no persistent stump in this game's lifecycle");
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${session.output}/played-tree-removed.png` });
  session.rows.push({ name: "native-authored-tree-growth-fall-removal", grown, chopped, removed,
    limit: "Public felling hook fixture; no naturally staffed woodcutter production or log-credit claim" });
  const depleted = await page.evaluate(async () => {
    const { world } = (window as any).__editorReview, stone = (window as any).__editorStone;
    const { PROP, PROP_REMOVED } = await import(/* @vite-ignore */ String("/src/shared/world/world-data.ts"));
    const id = Array.from({ length: world.props.count }, (_, index) => world.props.count - 1 - index)
      .find(id => world.props.types[id] === PROP.largeRock && stone.canConsume({
        id, kind: "stone", x: world.props.x[id], z: world.props.z[id] }));
    if (id === undefined) throw new Error("No authored or generated quarry boulder can be consumed");
    const target = { id, kind: "stone", x: world.props.x[id], z: world.props.z[id] };
    const before = stone.remaining(target);
    for (let count = 0; count < before; count++) if (!stone.consume(target))
      throw new Error("Finite native quarry extraction failed");
    (window as any).__settlement.focusGround(target.x, target.z, 3);
    return { before, id, remaining: stone.remaining(target), removed: world.props.types[id] === PROP_REMOVED };
  });
  assert.equal(depleted.remaining, 0); assert(depleted.removed);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${session.output}/played-quarry-depleted.png` });
  await saveFromMenu(page);
  await resumeSavedGame(page);
  const restored = await page.evaluate(({ id, ids }) => {
    const { felling, world } = (window as any).__editorReview, stone = (window as any).__editorStone;
    return { phases: ids.map(id => felling.getPhase(id)), remaining: stone.remaining({ id, kind: "stone",
      x: world.props.x[id], z: world.props.z[id] }) };
  }, { ids: grown.ids, id: depleted.id });
  assert(restored.phases.every(phase => phase === "removed")); assert.equal(restored.remaining, 0);
  session.rows.push({ name: "native-quarry-depletion-and-tree-removal-game-reload", depleted, restored,
    limit: "Native stone resource controller fixture; no naturally staffed quarry production or stone-credit claim" });
  session.flush();
};
