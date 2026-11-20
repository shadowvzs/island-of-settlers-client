import { expect, it } from "vitest";

import { BUILDING_CATALOG } from "../src/render-common/buildings/building-catalog";
import type { BuildingPart, BuildingRecipe } from "../src/render-common/buildings/building-recipe";
import { getRomanPartBounds, getRomanRecipeBounds } from "../src/render-common/buildings/building-recipe-fit";
import { indigenousBuildingStyle } from "../src/render-common/buildings/indigenous-building-recipe";
import { addIndigenousFortress } from "../src/render-common/buildings/indigenous-fortress";
import { addIndigenousFramedBody } from "../src/render-common/buildings/indigenous-framed-body";
import { addIndigenousLodge } from "../src/render-common/buildings/indigenous-lodges";
import { clearIndigenousInheritedProps } from "../src/render-common/buildings/indigenous-prop-clearance";
import { indigenousRoofHeight } from "../src/render-common/buildings/indigenous-roof-profile";
import { leveledBuildingRecipe } from "../src/render-common/buildings/levels/leveled-building-recipe";
import {
  createLevelPlanRecipe, createNationBuildingRecipe
} from "../src/render-common/buildings/nation-building-recipe";
import { classifyNationBody } from "../src/render-common/buildings/nation-kit-classify";
import { rotateByEuler } from "../src/render-common/buildings/recipe-rotation";
import { hasPlayerAvatarBody, playerAvatarBody } from "../src/render-common/workers/player-avatar";
import { isWorkerNation, randomWorkerAppearances } from "../src/render-common/workers/worker-appearance";
import { workerBodyNation } from "../src/render-common/workers/worker-body-nation";
import { nationDrinkChain } from "../src/shared/settlement/nation-drinks";

it("rebuilds the fortress around its unchanged six supported fighting posts and a substantial covered body", () => {
  const definition = BUILDING_CATALOG.find(building => building.id === 9)!;
  for (const detailed of [true, false]) {
    const original = createLevelPlanRecipe(definition, detailed, 1).plan;
    const parts: BuildingPart[] = [];
    addIndigenousFortress(part => parts.push({ stage: 1, ...part }), original,
      classifyNationBody(original), detailed);
    expect(parts.filter(part => part.shape === "indigenous-roof")).toHaveLength(6);
    const skins = parts.filter(part => part.shape === "indigenous-roof");
    expect(parts.some(part => part.shape === "rock" && part.surface === "stone")).toBe(true);
    const floors = parts.filter(part => part.surface === "planks").map(part => getRomanPartBounds(part));
    for (const [x, y, z] of original.archerPositions!) for (const sx of [-.09, .09])
      for (const sz of [-.09, .09]) expect(floors.some(floor =>
        x + sx >= floor.min[0] && x + sx <= floor.max[0] &&
        z + sz >= floor.min[2] && z + sz <= floor.max[2] && Math.abs(y - floor.max[1]) < .001),
      `Unsupported fortress foot patch ${x},${y},${z}`).toBe(true);
    for (const part of parts.filter(part => part.surface === "wood"))
      for (const sx of [-.5, 0, .5]) for (const sy of [-.5, 0, .5]) for (const sz of [-.5, 0, .5]) {
        const local = rotateByEuler([sx * part.size[0], sy * part.size[1], sz * part.size[2]],
          part.rotation ?? [0, 0, 0]);
        const x = part.position[0] + local[0], y = part.position[1] + local[1];
        const z = part.position[2] + local[2];
        if (y < .18 || y > 1.90) continue; // Ground pegs and the open fighting landings are exposed.
        if (Math.abs(z - original.door[2]) < .08 && Math.abs(x) < .36) continue; // Real portal jambs.
        expect(skins.some(skin => {
          const u = (x - skin.position[0]) / skin.size[0], v = (z - skin.position[2]) / skin.size[2];
          if (Math.abs(u) > .494 || Math.abs(v) > .494) return false;
          const ceiling = skin.position[1] + skin.size[1] * indigenousRoofHeight(skin.indigenousRoof!, u, v,
            skin.indigenousEntrance, skin.indigenousRearEntrance);
          return y <= ceiling + .001;
        }), `Exposed structural timber below fighting decks: ${x},${y},${z}`).toBe(true);
      }
  }
});

it("preserves work, inventory and entrance contracts across the complete Indigenous building roster", () => {
  for (const detailed of [true, false]) for (const definition of BUILDING_CATALOG) {
    const original = createLevelPlanRecipe(definition, detailed, 1).plan;
    const recipe = createNationBuildingRecipe(definition, "indigenous", detailed);
    const { hideBalconyDoor: originalHideBalcony, hideDoor: originalHideDoor,
      parts: originalParts, ...originalAnchors } = original;
    const { drinkNation, hideBalconyDoor, hideDoor, parts, tentDoor, ...anchors } = recipe;
    expect(Boolean(hideBalconyDoor)).toBe(definition.id === 14 || Boolean(originalHideBalcony));
    expect(Boolean(hideDoor)).toBe(definition.id === 18 || Boolean(originalHideDoor));
    if (definition.id === 6) expect(drinkNation).toBe("indigenous");
    else expect(drinkNation).toBeUndefined();
    if (definition.style !== "well" && ![7, 16].includes(definition.id))
      expect(tentDoor).toBe(![19, 43, 47, 51, 55].includes(definition.id));
    expect(anchors, `${definition.id}/anchors`).toEqual(originalAnchors);
    const expectedStocks = originalParts.filter(part => part.stock).map(part => {
      if (definition.id !== 55 || part.stock!.slot < 3) return part;
      // The owner-approved upper granite rack has a real board bearing above the lower cargo.
      return { ...part, position: [part.position[0], part.position[1] + .10, part.position[2]] };
    });
    expect(parts.filter(part => part.stock), `${definition.id}/inventory`).toEqual(expectedStocks);
    const before = getRomanRecipeBounds(definition, original), after = getRomanRecipeBounds(definition, recipe);
    expect(after.extentX, `${definition.id}/x`).toBeLessThanOrEqual(before.extentX + .001);
    expect(after.extentZ, `${definition.id}/z`).toBeLessThanOrEqual(before.extentZ + .001);
    expect(parts.every(part => [...part.position, ...part.size].every(Number.isFinite))).toBe(true);
    expect(parts.every(part => part.size.every(size => size > 0))).toBe(true);
    expect(parts.some(part => part.shape === "civic-statue" || part.shape === "tile")).toBe(false);
  }
});

it("removes inherited fittings crossing the fabric and unsupported caps while retaining grounded equipment and stock", () => {
  const part = (position: BuildingPart["position"], size: BuildingPart["size"]): BuildingPart =>
    ({ position, shape: "box", size, stage: 2, surface: "wood" });
  const skin: BuildingPart = { indigenousRoof: "tipi", indigenousEntrance: [-.2, .2, .1],
    position: [0, 1, 0], shape: "indigenous-roof", size: [2, 2, 2], stage: 2, surface: "cloth" };
  const pierced = part([.7, .7, 0], [.4, .04, .04]);
  const floating = part([1.4, 1.3, 0], [.15, .04, .15]);
  const grounded = part([1.3, .2, 0], [.08, .4, .08]);
  const bench = part([1.3, .42, 0], [.3, .04, .25]);
  const stock: BuildingPart = { ...pierced, stock: { kind: "output", slot: 0, ware: "planks" } };
  const inherited = new Set([pierced, floating, grounded, bench, stock]);
  expect(clearIndigenousInheritedProps([skin, ...inherited], inherited)).toEqual([skin, grounded, bench, stock]);
});

it("keeps the exterior approach clear on both detail levels and all upgrade levels", () => {
  for (const detailed of [true, false]) for (const definition of BUILDING_CATALOG) {
    if (definition.style === "well" || definition.id === 7) continue;
    for (const level of [1, 2, 3, 4, 5] as const) {
      const recipe = leveledBuildingRecipe(definition, "indigenous", detailed, level);
      const centre = recipe.door[0] + (recipe.doorDimensions?.width ?? .46) / 2;
      const front = recipe.door[2] - .016;
      const blocked = recipe.parts.filter(part => {
        if (part.shape === "stone-arc") return false;
        if (part.shape === "indigenous-roof" && part.indigenousEntrance) {
          for (const dx of [-.3, 0, .3]) for (const dz of [.2, .4, .6]) {
            const x = (centre + dx - part.position[0]) / part.size[0];
            const z = (front + dz - part.position[2]) / part.size[2];
            if (Math.abs(x) > .5 || Math.abs(z) > .5) continue;
            const top = part.position[1] + indigenousRoofHeight(part.indigenousRoof ?? "tipi", x, z,
              part.indigenousEntrance) * part.size[1];
            if (top < .82) return true;
          }
          return false;
        }
        const { max, min } = getRomanPartBounds(part);
        return min[0] < centre + .31 && max[0] > centre - .31 && min[1] < .82 && max[1] > .025 &&
          min[2] < front + .95 && max[2] > front + .19;
      });
      expect(blocked, `${definition.id}/${detailed}/${level}/approach`).toEqual([]);
    }
  }
});

it("provides different shelter families and a bespoke monument", () => {
  expect(new Set([0, 17, 18, 35].map(id => indigenousBuildingStyle(id).profile)).size).toBe(4);
  const monument = BUILDING_CATALOG.find(definition => definition.id === 7)!;
  for (const detailed of [true, false]) {
    const recipe = createNationBuildingRecipe(monument, "indigenous", detailed);
    expect(recipe.hideDoor).toBe(true);
    expect(recipe.parts.some(part => part.shape === "indigenous-palm-roof")).toBe(true);
    expect(recipe.parts.length).toBeGreaterThan(20);
  }
});

it("uses the published civilian roster without changing national production identity", () => {
  expect(isWorkerNation("indigenous")).toBe(true);
  expect(isWorkerNation("moche")).toBe(false);
  const bodies = randomWorkerAppearances(6, "indigenous", () => .5);
  const published = workerBodyNation("indigenous");
  expect(bodies.every(body => body.nation === "indigenous" && body.variant.startsWith(`${published}-`))).toBe(true);
  for (const gender of ["female", "male"] as const)
    expect(hasPlayerAvatarBody("indigenous", playerAvatarBody("indigenous", gender).variant, gender)).toBe(true);
  expect(nationDrinkChain("indigenous")).toMatchObject({ raw: "berries", drink: "berryDrink" });
});

it("keeps the complete thickness of hidden timber frames at least four centimetres below the membrane", () => {
  for (const rounded of [false, true]) for (const detailed of [true, false])
    for (const [width, depth, height] of [[.7, .7, .93], [1.7, 1.4, 2.1], [3.4, 2.8, 1.75], [1.3, 1.12, 2.56]]) {
      const parts: BuildingPart[] = [], opening = Math.min(.46, width! * .35);
      const original: BuildingRecipe = { doorProfile: "flat", parts: [], door: [-opening / 2, 0, depth! / 2 - .04],
        doorDimensions: { height: .5, spring: .4, width: opening }, mechanism: [0, 0, 0],
        workerExit: [0, 0, depth!], workPoint: [width!, 0, depth!] };
      addIndigenousLodge(part => parts.push({ stage: 1, ...part }), original,
        { doorSurround: [], keep: [], walls: [], roofs: [{ min: [-width! / 2, 0, -depth! / 2],
          max: [width! / 2, height!, depth! / 2] }] }, rounded, detailed, height, height);
      const membrane = parts.find(part => part.shape === "indigenous-roof")!;
      const rise = membrane.size[1];
      const frame = parts.filter(part => part.surface === "wood" && part.shape === "box" &&
        getRomanPartBounds(part).max[1] < rise - .035);
      expect(frame.length).toBeGreaterThan(0);
      for (const part of frame) for (const sx of [-.5, .5]) for (const sy of [-.5, .5])
        for (const sz of [-.5, .5]) {
          const corner = rotateByEuler([sx * part.size[0], sy * part.size[1], sz * part.size[2]],
            part.rotation ?? [0, 0, 0]);
          const x = part.position[0] + corner[0], y = part.position[1] + corner[1];
          const z = part.position[2] + corner[2];
          const radius = Math.hypot(x * 2 / membrane.size[0], z * 2 / membrane.size[2]);
          // A capsule encloses this ellipsoid, so this is a conservative interior ceiling.
          const ceiling = rounded ? rise * Math.sqrt(Math.max(0, 1 - radius * radius)) : rise * (1 - radius);
          expect(ceiling - y, `${rounded}/${detailed}/${width}/${part.position.join(",")}`).toBeGreaterThanOrEqual(.04);
        }
    }
});

it("encloses the mill bearing timber and keeps the well uncovered around its rough-stone shaft", () => {
  for (const detailed of [true, false]) {
    const well = createNationBuildingRecipe(BUILDING_CATALOG.find(definition => definition.id === 35)!,
      "indigenous", detailed);
    expect(well.parts.some(part => part.shape === "indigenous-roof")).toBe(false);
    expect(well.parts.filter(part => part.shape === "structural-rock")).toHaveLength(16);
    expect(well.parts.some(part => part.shape === "bowl")).toBe(false);
    expect(well.parts.some(part => !part.stock && part.surface === "dark" && part.shape === "cylinder")).toBe(true);
    const mill = createNationBuildingRecipe(BUILDING_CATALOG.find(definition => definition.id === 31)!,
      "indigenous", detailed);
    const skin = mill.parts.find(part => part.shape === "indigenous-roof" && part.indigenousEntrance)!;
    expect(skin.size[1]).toBeGreaterThan(2.3);
    for (const part of mill.parts.filter(part => part.compactGeometry && part.surface === "wood" &&
      part.shape === "box")) for (const sx of [-.5, .5]) for (const sy of [-.5, .5])
      for (const sz of [-.5, .5]) {
        const point = rotateByEuler([sx * part.size[0], sy * part.size[1], sz * part.size[2]],
          part.rotation ?? [0, 0, 0]);
        const u = (part.position[0] + point[0] - skin.position[0]) / skin.size[0];
        const v = (part.position[2] + point[2] - skin.position[2]) / skin.size[2];
        const ceiling = skin.position[1] + skin.size[1] * indigenousRoofHeight("earth", u, v);
        expect(ceiling - part.position[1] - point[1]).toBeGreaterThanOrEqual(.04);
      }
  }
});

it("carries rectangular fighting floors on a complete frame concealed inside the textile sleeve", () => {
  for (const detailed of [true, false]) for (const size of [[1.3, 2.555, 1.12], [1.05, 1.715, .88],
    [.432, 1.91, .684], [1.14, 2.41, .85]] as const) {
    const parts: BuildingPart[] = [];
    const original: BuildingRecipe = { doorProfile: "flat", parts: [], door: [-.10, 0, size[2] / 2],
      doorDimensions: { height: .5, spring: .4, width: .2 }, mechanism: [0, 0, 0],
      workerExit: [0, 0, 2], workPoint: [0, 0, 2] };
    addIndigenousFramedBody(part => parts.push({ stage: 1, ...part }), original,
      [0, 0, 0], [...size], detailed, undefined, false);
    const withPortal: BuildingPart[] = [];
    addIndigenousFramedBody(part => withPortal.push({ stage: 1, ...part }), original,
      [0, 0, 0], [...size], detailed);
    const existing = new Set(parts.map(part => JSON.stringify(part)));
    const visiblePortal = withPortal.filter(part => !existing.has(JSON.stringify(part)));
    expect(visiblePortal).toHaveLength(3);
    for (const part of visiblePortal) {
      const bounds = getRomanPartBounds(part);
      // Visible entrance hardware belongs to the real cloth cutout, outside the concealed frame.
      expect(bounds.min[0]).toBeGreaterThanOrEqual(-.20);
      expect(bounds.max[0]).toBeLessThanOrEqual(.20);
      expect(bounds.min[1]).toBeGreaterThanOrEqual(0);
      expect(bounds.max[1]).toBeLessThanOrEqual(.63);
    }
    const frame = parts.filter(part => part.surface === "wood" && part.shape === "box");
    expect(frame.filter(part => part.size[1] === size[1])).toHaveLength(4);
    expect(frame.some(part => Math.abs(getRomanPartBounds(part).max[1] - size[1]) < .0001)).toBe(true);
    for (const part of frame) for (const sx of [-.5, .5]) for (const sy of [-.5, .5])
      for (const sz of [-.5, .5]) {
        const vertex = rotateByEuler([sx * part.size[0], sy * part.size[1], sz * part.size[2]],
          part.rotation ?? [0, 0, 0]);
        // The maximum native billow removes .6% of each full span from its side clearance.
        expect(size[0] * .494 - Math.abs(part.position[0] + vertex[0])).toBeGreaterThanOrEqual(.04);
        expect(size[2] * .494 - Math.abs(part.position[2] + vertex[2])).toBeGreaterThanOrEqual(.04);
        expect(part.position[1] + vertex[1]).toBeLessThanOrEqual(size[1] + .0001);
      }
  }
});
