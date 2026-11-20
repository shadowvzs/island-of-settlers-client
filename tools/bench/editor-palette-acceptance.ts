import assert from "node:assert/strict";

import { SPECIES } from "../../src/render-common/wildlife/wildlife-species";
import { DECORATION_KINDS } from "../../src/shared/world/editing/decoration-editing";
import { ORE, PROP } from "../../src/shared/world/world-data";
import { exerciseEditorFishing, prepareEditorFishing } from "./editor-fishing-acceptance";
import { type EditorSession, selectPaletteDecoration, startEditorSession, terrainTab } from "./editor-native-session";
import { exerciseEditorTreeLifecycles } from "./editor-palette-lifecycle";

const spot = async (s: EditorSession, kind: number) => {
  const candidates = await s.page.evaluate(async kind => {
  const { world } = (window as any).__editorReview;
  const { checkPropSpot } = await import(/* @vite-ignore */ String("/src/shared/world/editing/prop-placement.ts"));
  const { sampleSmooth } = await import(/* @vite-ignore */ String("/src/shared/world/grid-geometry.ts"));
  const { PROP } = await import(/* @vite-ignore */ String("/src/shared/world/world-data.ts"));
  const hq = (window as any).__settlement.simulation.headquarters;
  const candidates: { x: number; z: number }[] = [];
  for (let z = 16; z < world.cellsZ - 16; z += 2) for (let x = 16; x < world.cellsX - 16; x += 2) {
    if (Math.hypot(x - hq.x, z - hq.z) < 24) continue;
    if ([PROP.reeds, PROP.cattail].includes(kind) && sampleSmooth(world, world.waterDepth, x + .5, z + .5) <= .05) continue;
    if (!checkPropSpot(world, kind, x + .5, z + .5)) candidates.push({ x: x + .5, z: z + .5 });
    if (candidates.length === 128) return candidates;
  }
  return candidates;
  }, kind);
  for (const point of candidates) {
    await s.focus(point);
    const actual = await s.page.evaluate(async ({ kind, point }) => {
      const { renderer, world } = (window as any).__editorReview;
      const screen = (window as any).__settlement.projectGround(point.x, point.z);
      const picked = renderer.pickGround(screen.x, screen.y);
      if (!picked) return null;
      const { checkPropSpot } = await import(/* @vite-ignore */ String("/src/shared/world/editing/prop-placement.ts"));
      const { sampleSmooth } = await import(/* @vite-ignore */ String("/src/shared/world/grid-geometry.ts"));
      const { PROP } = await import(/* @vite-ignore */ String("/src/shared/world/world-data.ts"));
      const depth = sampleSmooth(world, world.waterDepth, picked.x, picked.z);
      if ([PROP.reeds, PROP.cattail].includes(kind) && depth <= .05) return null;
      return checkPropSpot(world, kind, picked.x, picked.z) ? null : { picked, depth };
    }, { point, kind });
    if (actual) { s.rows.push({ name: "palette-actual-pixel-preflight", kind, point, ...actual }); return point; }
  }
  throw new Error(`No supported actual projected palette point for kind ${kind} among ${candidates.length} candidates`);
};

for (const quality of (process.env.QUALITIES ?? "high,minimal").split(",")) {
  const s = await startEditorSession(quality, "palettes");
  const { button, page } = s;
  try {
    const { DOODAD_CHOICES, TREE_CHOICES } = await page.evaluate(async () => {
      const catalog = await import(/* @vite-ignore */ String("/src/app/map-editor/editor-catalog.ts"));
      const choices = (entries: { label: string; value: number }[]) => entries.map(({ label, value }) => ({ label, value }));
      return { DOODAD_CHOICES: choices(catalog.DOODAD_CHOICES), TREE_CHOICES: choices(catalog.TREE_CHOICES) };
    });
    if (process.env.ONLY_ANIMALS !== "1") {
    await page.getByRole("tab", { name: "Trees and forestry", exact: true }).click();
    let treePoint: { x: number; z: number } | undefined;
    let treeId = -1;
    for (const [index, tree] of TREE_CHOICES.entries()) {
      const point = await spot(s, tree.value);
      await s.step(`tree-${tree.label.toLowerCase()}`, async () => {
        await button(tree.label).click();
        await page.getByRole("combobox", { name: "Initial tree age", exact: true })
          .selectOption(String([0, 30, 60, 90, 120][index % 5]));
        await s.click(point);
      });
      if (treeId < 0) {
        const actual = await page.evaluate(() => {
          const { props } = (window as any).__editorReview.world, id = props.count - 1;
          return { id, point: { x: props.x[id], z: props.z[id] } };
        });
        treeId = actual.id; treePoint = actual.point;
      }
    }
    assert(treePoint);
    await terrainTab(page);
    await page.getByRole("slider", { name: /^Brush size:/ }).fill("1");
    for (const mode of ["Raise ground", "Smooth ground", "Lower ground"]) {
      await s.step(`tree-contact-${mode.split(" ")[0]!.toLowerCase()}`, async () => {
        await button(mode).click(); await s.click(treePoint!);
      });
      const drift: number = await page.evaluate(async id => {
        const { world } = (window as any).__editorReview;
        const { sampleSmooth } = await import(/* @vite-ignore */ String("/src/shared/world/grid-geometry.ts"));
        const point = { x: world.props.x[id], z: world.props.z[id] };
        return Math.abs(world.props.y[id] - sampleSmooth(world, world.heights, point.x, point.z));
      }, treeId);
      assert(drift < .00001, `${mode} reanchors the actual placed tree`);
    }
    for (const stone of DOODAD_CHOICES) {
      const point = await spot(s, stone.value);
      const quarry = stone.value === PROP.largeRock;
      await page.getByRole("tab", { name: "Stone, marble and mine deposits", exact: true }).click();
      await s.step(`stone-${stone.label.toLowerCase().replaceAll(" ", "-")}`, async () => {
        await button(quarry ? "Quarry stone boulder" : stone.label).click(); await s.click(point);
      });
    }
    await page.getByRole("tab", { name: "Plants and decorations", exact: true }).click();
    for (const kind of [PROP.waterLily, PROP.reeds, PROP.cattail]) {
      const point = await spot(s, kind);
      await s.step(`aquatic-${kind}`, async () => {
        await selectPaletteDecoration(page, DECORATION_KINDS.find(([, value]) => value === kind)![0]);
        await s.click(point);
      });
    }
    await page.getByRole("tab", { name: "Stone, marble and mine deposits", exact: true }).click();
    const ore = page.getByRole("combobox", { name: "Ore deposit quantity", exact: true });
    const values = await ore.locator("option").evaluateAll(options => options.map(o => (o as HTMLOptionElement).value)
      .filter(Boolean));
    assert(values.length >= 4);
    const wanted = await page.evaluate(() => {
      const { world } = (window as any).__editorReview, seen = new Set<number>();
      return world.mineZones.filter((zone: any) => {
        if (!zone.ore || seen.has(zone.ore)) return false;
        seen.add(zone.ore); return true;
      }).map((zone: any) => String(zone.id));
    });
    assert.equal(wanted.length, 4, "All four actual mineral types must be represented");
    assert(wanted.every((value: string) => values.includes(value)));
    for (const value of wanted) {
      await ore.selectOption(value);
      for (const total of [37, 0]) await s.step(`ore-${value}-total-${total}`, async () => {
        await page.getByRole("spinbutton", { name: "Total ore in deposit", exact: true }).fill(String(total));
        await button("Set exact total ore").click();
      });
    }
    }
    if (process.env.ONLY_ANIMALS === "1") {
      await page.getByRole("tab", { name: "Plants and decorations", exact: true }).click();
      for (const kind of [PROP.reeds, PROP.cattail]) {
        const point = await spot(s, kind);
        await s.step(`wet-aquatic-${kind}`, async () => {
          await selectPaletteDecoration(page, DECORATION_KINDS.find(([, value]) => value === kind)![0]);
          await s.click(point);
        });
      }
      await page.getByRole("tab", { name: "Stone, marble and mine deposits", exact: true }).click();
      const gold = await page.evaluate(ore => (window as any).__editorReview.world.mineZones
        .find((zone: any) => zone.ore === ore).id, ORE.gold);
      await page.getByRole("combobox", { name: "Ore deposit quantity", exact: true }).selectOption(String(gold));
      for (const total of [37, 0]) await s.step(`gold-total-${total}`, async () => {
        await page.getByRole("spinbutton", { name: "Total ore in deposit", exact: true }).fill(String(total));
        await button("Set exact total ore").click();
      });
    }
    await page.getByRole("tab", { name: "Animals and habitats", exact: true }).click();
    for (const [species, name] of [[SPECIES.deer, "Deer"], [SPECIES.elk, "Elk"], [SPECIES.rabbit, "Rabbit"]] as const) {
      const age = page.getByRole("combobox", { name: "Initial animal age", exact: true });
      const options = await age.locator("option").evaluateAll(options => options.map(o => (o as HTMLOptionElement).value));
      for (const [ageIndex, value] of options.entries()) {
        const population = [1, 2, 4, 2, 1][ageIndex % 5]!;
        const candidates = await page.evaluate(async ([species, age, population]) => {
          const { animals, mapEditor, world } = (window as any).__editorReview;
          const placed = mapEditor.saveInput().animals;
          const { animalBodyRoom } = await import(/* @vite-ignore */ String(
            "/src/render-common/wildlife/manager/animal-editor-placement.ts"));
          const { isBodyFree } = await import(/* @vite-ignore */ String(
            "/src/render-common/wildlife/nav/nav-query.ts"));
          const { animalStampPoints } = await import(/* @vite-ignore */ String("/src/app/map-editor/editor-apply.ts"));
          const group = (x: number, z: number): { age: number; species: number; x: number; z: number }[] =>
            animalStampPoints(species, population, { x, z })
            .map((point: { x: number; z: number }) => ({ ...point, age, species }));
          const pool = animals.manager.debug.pool;
          /** Live animals wander: keep the next test placement well outside their home range. */
          const occupied = (x: number, z: number) =>
            placed.some((a: any) => Math.hypot(a.x - x, a.z - z) < 5) ||
            Array.from({ length: pool.active.length }, (_, id) => id).some(id =>
              pool.active[id] && Math.hypot(pool.x[id] - x, pool.z[id] - z) < 20);
          const candidates: { x: number; z: number }[] = [];
          for (let z = 16.5; z < world.cellsZ - 16; z += 4) for (let x = 16.5; x < world.cellsX - 16; x += 4) {
            if (occupied(x, z)) continue;
            const members = group(x, z);
            if (!members.every(point => animalBodyRoom({ pool: animals.manager.debug.pool }, species, point.x, point.z))) continue;
            if (!members.every(point => Array.from({ length: 8 }, (_, i) => i * Math.PI / 4).every(heading =>
              isBodyFree(animals.manager.debug.nav, species, point.x, point.z, heading, 1.3)))) continue;
            if (!animals.manager.validateAuthored(members).length) candidates.push({ x, z });
            if (candidates.length === 32) return candidates;
          }
          return candidates;
        }, [species, Number(value), population] as const);
        let point: { x: number; z: number } | undefined;
        for (const candidate of candidates) {
          await s.focus(candidate);
          const actual = await page.evaluate(async ({ age, candidate, population, species }) => {
            const { animals, renderer } = (window as any).__editorReview;
            const screen = (window as any).__settlement.projectGround(candidate.x, candidate.z);
            // Keep the click off the HUD/toast at the top and the editor panel on the left.
            if (screen.x < 440 || screen.x > innerWidth - 20 ||
              screen.y < 90 || screen.y > innerHeight - 150) return null;
            const picked = renderer.pickGround(screen.x, screen.y);
            if (!picked) return null;
            const { animalBodyRoom } = await import(/* @vite-ignore */ String(
              "/src/render-common/wildlife/manager/animal-editor-placement.ts"));
            const { isBodyFree } = await import(/* @vite-ignore */ String(
              "/src/render-common/wildlife/nav/nav-query.ts"));
            const { animalStampPoints } = await import(/* @vite-ignore */ String("/src/app/map-editor/editor-apply.ts"));
            const members: { age: number; species: number; x: number; z: number }[] = animalStampPoints(species, population, picked)
              .map((point: { x: number; z: number }) => ({ ...point, age, species }));
            if (!members.every(point => animalBodyRoom({ pool: animals.manager.debug.pool }, species, point.x, point.z))) return null;
            if (!members.every(point => Array.from({ length: 8 }, (_, i) => i * Math.PI / 4).every(heading =>
              isBodyFree(animals.manager.debug.nav, species, point.x, point.z, heading, 1.3)))) return null;
            return animals.manager.validateAuthored(members).length ? null : picked;
          }, { candidate, population, species, age: Number(value) });
          if (actual) { point = candidate; s.rows.push({ name: "animal-actual-pixel-preflight", species, age: value, actual }); break; }
        }
        assert(point, `No supported actual projected animal point among ${candidates.length} candidates`);
        const beforePopulation = await page.evaluate(() =>
          (window as any).__editorReview.mapEditor.saveInput().animals.length);
        await s.step(`animal-${name.toLowerCase()}-${value}-population-${population}`, async () => {
          if (await button(name).getAttribute("aria-pressed") !== "true") await button(name).click();
          await age.selectOption(value);
          await page.getByRole("spinbutton", { name: "Animal population per placement", exact: true }).fill(String(population));
          await s.click(point!);
        });
        const afterPopulation = await page.evaluate(() =>
          (window as any).__editorReview.mapEditor.saveInput().animals.length);
        assert.equal(afterPopulation - beforePopulation, population, "Every requested authored animal is placed");
        s.rows.push({ name: "actual-animal-population", afterPopulation, beforePopulation, population, species });
        s.flush();
      }
    }
    const fishing = process.env.ONLY_ANIMALS !== "1" ? await prepareEditorFishing(s) : null;
    await s.save();
    if (process.env.ONLY_ANIMALS !== "1") {
      await exerciseEditorTreeLifecycles(s);
      if (fishing) await exerciseEditorFishing(s, fishing);
    }
  } catch (error) { s.rows.push({ name: "failure", error: error instanceof Error ? error.stack : String(error) }); throw error; }
  finally { await s.close(); }
}
