import { type Mesh, Vector3 } from "three";
import { expect, it } from "vitest";

import { ROAD_DECORATION_ITEM_DEFINITIONS } from "../../island-of-settlers-shared/src/road-decoration-items";
import { PLANT_COMPLETION_ITEM_IDS } from "../../island-of-settlers-shared/src/road-plant-completion";
import { catalogBotanicalClearance, catalogBotanicalEnvelope } from
  "../src/render-common/plants/catalog-orchard-bounds";
import { createCatalogOrchardGraph } from "../src/render-common/plants/catalog-orchard-graph";
import { createCatalogPalmGraph } from "../src/render-common/plants/catalog-palm-graph";
import { createPlantCompletionModels } from "../src/renderers/three/plants/plant-completion-model";
import { plantCompletionProfile } from "../src/renderers/three/plants/plant-completion-profile";

const SPECIES = ["date-palm", "dwarf-coconut", "fan-palm", "acacia-standard", "olive-standard"] as const;
const palm = (species: "date-palm" | "dwarf-coconut" | "fan-palm", detail: number, variant = 0) =>
  createCatalogPalmGraph(species, variant, detail, true);
const orchard = (species: "acacia-standard" | "olive-standard", detail: number, variant = 0) =>
  createCatalogOrchardGraph(species, variant, detail, true);
const bladeLength = (blade: { start: number[]; end: number[] }) =>
  Math.hypot(blade.end[0]! - blade.start[0]!, blade.end[1]! - blade.start[1]!,
    blade.end[2]! - blade.start[2]!);

it("keeps the dwarf coconut and date palm leaflets clearly long and wide", () => {
  for (const variant of [0, 1, 2] as const) {
    const coconut = palm("dwarf-coconut", 2, variant), date = palm("date-palm", 2, variant);
    expect(Math.max(...coconut.blades.map(bladeLength))).toBeGreaterThan(.29);
    expect(Math.max(...coconut.blades.map(blade => blade.width))).toBeGreaterThanOrEqual(.032);
    expect(Math.max(...date.blades.map(bladeLength))).toBeGreaterThan(.25);
    expect(Math.max(...date.blades.map(blade => blade.width))).toBeGreaterThanOrEqual(.028);
  }
});

it("attaches dense date bunches as separate models with many small, unevenly ripening dates", () => {
  const graph = palm("date-palm", 2);
  expect(graph.fruits).toHaveLength(0);
  expect(graph.attachments.length).toBeGreaterThanOrEqual(5);
  const bunches = graph.attachments.map(attachment => attachment.graph);
  const dates = bunches.flatMap(bunch => bunch.fruits);
  expect(dates.length).toBeGreaterThanOrEqual(280);
  expect(dates.every(fruit => fruit.kind === "date" && fruit.radius[0] <= .018 && fruit.radius[1] <= .025))
    .toBe(true);
  const strands = bunches.flatMap(bunch => bunch.tubes.filter(tube => tube.green && tube.radius >= .004 &&
    tube.radius <= .005 && tube.path.length === 3));
  expect(strands.length).toBeGreaterThanOrEqual(30);
  const green = dates.filter(fruit => fruit.colour[1] > fruit.colour[0] * 1.15);
  const amber = dates.filter(fruit => fruit.colour[0] > fruit.colour[1] * 1.45);
  expect(green.length).toBeGreaterThan(8);
  expect(amber.length).toBeGreaterThan(20);
  const crown = graph.attachments[0]!.anchor[1];
  expect(Math.min(...dates.map(fruit => fruit.centre[1]))).toBeLessThan(crown - .12);
  for (const attachment of graph.attachments) {
    expect(attachment.anchor[1]).toBeGreaterThan(graph.height - .6);
    expect(attachment.yaw).toBeGreaterThanOrEqual(-Math.PI * 2);
  }
});

const datePalm = () => PLANT_COMPLETION_ITEM_IDS.map(id => ROAD_DECORATION_ITEM_DEFINITIONS[id]!)
  .find(candidate => candidate.plant?.species === "date-palm")!.plant!;

it("renders visible High dates as closed eight-triangle ellipsoids", () => {
  const model = createPlantCompletionModels(true).create(datePalm(), "near");
  try {
    const bunches = model.root.children.find(child => child.name === "catalog-botanical-date-bunches") as
      Mesh | undefined;
    expect(bunches).toBeDefined();
    expect(bunches!.geometry.index!.count / 3).toBeGreaterThan(2500);
    bunches!.geometry.computeBoundingBox();
    const size = bunches!.geometry.boundingBox!.getSize(new Vector3());
    expect(size.x).toBeGreaterThan(.01);
    expect(size.y).toBeGreaterThan(.01);
    expect(size.z).toBeGreaterThan(.01);
  } finally { model.dispose(); }
});

it("keeps all date bunches separate from the palm surfaces in one mesh per palm", () => {
  for (const detailed of [true, false]) {
    const model = createPlantCompletionModels(detailed).create(datePalm(), "near");
    try {
      const names = model.root.children.map(child => child.name);
      expect(names).not.toContain("");
      expect(names.some(name => name.includes("-attachment-"))).toBe(false);
      const bunches = model.root.children.find(child => child.name === "catalog-botanical-date-bunches");
      expect(bunches).toBeDefined();
      const ranges = bunches!.userData.bunchRanges as unknown[];
      expect(ranges).toHaveLength(detailed ? 6 : 5);
      expect(names).toHaveLength(3);
    } finally { model.dispose(); }
  }
});

it("builds costapalmate fans on outward stalks, not a dome of detached discs", () => {
  for (const variant of [0, 1, 2] as const) {
    const graph = palm("fan-palm", 2, variant);
    expect(graph.fans.length).toBeGreaterThanOrEqual(9);
    for (const fan of graph.fans) {
      expect(fan.costa).toBeGreaterThanOrEqual(.16);
      expect(fan.elevation).toBeGreaterThan(.95);
      expect(fan.radius).toBeGreaterThan(.35);
      const outward = Math.cos(fan.direction) * fan.start[0] + Math.sin(fan.direction) * fan.start[2];
      expect(outward).toBeGreaterThan(.3);
      expect(graph.tubes.some(tube => tube.path.at(-1)!.every((value, axis) =>
        Math.abs(value - fan.start[axis]!) < 1e-9))).toBe(true);
    }
  }
});

it("gives the acacia rising forked limbs and bipinnate leaf rachides with tiny pinnules", () => {
  const graph = orchard("acacia-standard", 2);
  const limbs = graph.tubes.filter(tube => tube.path.length >= 3 && tube.radius > .02 &&
    tube.radius < .03 && tube.path.at(-1)![1] > tube.path[0]![1] + .25);
  expect(limbs.length).toBeGreaterThanOrEqual(7);
  const rachides = graph.tubes.filter(tube => tube.green && tube.radius <= .0045);
  expect(rachides.length).toBeGreaterThanOrEqual(250);
  expect(graph.blades.length).toBeGreaterThanOrEqual(1800);
  expect(Math.max(...graph.blades.map(bladeLength))).toBeLessThan(.12);
  expect(Math.max(...graph.blades.map(blade => blade.width))).toBeLessThanOrEqual(.029);
});

it("keeps the olive's gnarled bole, narrow leaves and raised crown clear of the road opening", () => {
  for (const variant of [0, 1, 2] as const) {
    const graph = orchard("olive-standard", 2, variant);
    expect(graph.tubes.filter(tube => tube.trunk).length).toBeGreaterThanOrEqual(2);
    const bole = graph.tubes.filter(tube => tube.path[0]![1] < .3 && tube.path.at(-1)![1] > 1.5);
    expect(bole.length).toBeGreaterThanOrEqual(3);
    expect(Math.max(...graph.blades.map(blade => blade.width))).toBeLessThanOrEqual(.032);
    expect(Math.min(...graph.blades.map(bladeLength))).toBeGreaterThan(.14);
    const clearance = catalogBotanicalClearance([graph]);
    expect(clearance[2]!.min[1]).toBeGreaterThanOrEqual(2.05);
  }
});

it("holds every refined tree inside its existing High, Minimal and far triangle budget", () => {
  const items = PLANT_COMPLETION_ITEM_IDS.map(id => ROAD_DECORATION_ITEM_DEFINITIONS[id]!)
    .filter(item => item.plant && SPECIES.includes(item.plant.species as typeof SPECIES[number]));
  expect(items).toHaveLength(30);
  for (const detailed of [true, false]) {
    const owner = createPlantCompletionModels(detailed);
    for (const item of items) for (const tier of ["near", "far"] as const) {
      if (tier === "far" && !detailed) continue;
      const model = owner.create(item.plant!, tier);
      const profile = plantCompletionProfile(item.plant!, detailed, false)!;
      expect(model.triangles, `${item.decoration}:${tier}`)
        .toBeLessThanOrEqual(tier === "far" ? profile.farCost : profile.cost);
      model.dispose();
    }
  }
});

it("keeps every refined palm and orchard canopy above the road opening", () => {
  for (const species of SPECIES) for (const variant of [0, 1, 2] as const) {
    const graph = species === "acacia-standard" || species === "olive-standard"
      ? orchard(species, 2, variant) : palm(species, 2, variant);
    const envelope = catalogBotanicalEnvelope(graph);
    expect(envelope.canopy.min[1], `${species}:${variant}`).toBeGreaterThanOrEqual(2.05);
    expect([envelope.horizontal, envelope.vertical].every(Number.isFinite)).toBe(true);
  }
});
