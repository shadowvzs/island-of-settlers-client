import { Matrix4 } from "three";
import { describe, expect, it } from "vitest";

import { createIslandStockContacts } from "../src/app/settlement/island-stock-contacts";
import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { MONUMENT_TYPE_ID } from "../src/render-common/buildings/monument-definition";
import { createConstructionPlan } from "../src/renderers/three/settlement/construction-plan";
import { getConstructionCost } from "../src/shared/settlement/construction-costs";
import { constructionStockLayout } from "../src/shared/settlement/construction-stock-layout";
import { applyConstructionContact, constructionHits, constructionSupplied } from "../src/shared/settlement/settlement-construction";
import type { SettlementBuilding } from "../src/shared/settlement/settlement-types";
import { huntingWorld } from "./helpers/hunting-world";

// The Monument took the retired Temple slot (ID 7); 63 is no longer a building code.
const cost = getConstructionCost(MONUMENT_TYPE_ID), wares = Object.keys(cost);
const site = (missing?: string) => ({ typeId: MONUMENT_TYPE_ID, x: 30.5, z: 30.5, y: 2, width: 9, depth: 9,
  rotation: 0, access: { x: 30.5, z: 35.5 }, construction: 0, required: { ...cost },
  input: { ...cost, ...(missing ? { [missing]: 19 } : {}) } }) as unknown as SettlementBuilding;

describe("generic Monument construction", () => {
  it("requires twenty of each five material pairs and consumes all200units through actual hammer contacts", () => {
    expect(wares).toEqual(["planks", "stone", "hardwoodPlanks", "marble", "cedarPlanks", "limestone",
      "walnutPlanks", "basalt", "mahoganyPlanks", "granite"]);
    expect(Object.values(cost)).toEqual(Array(10).fill(20));
    const building = site(); expect(constructionHits(building)).toBe(200);
    for (let contact = 0; contact < 200; contact++) expect(applyConstructionContact(building)).toBe(true);
    expect(building.construction).toBe(1); expect(building.constructionConsumed).toEqual(cost);
    expect(Object.values(building.input).every(value => value === 0)).toBe(true);
  });

  it.each(wares)("cannot finish when the last required %s unit is absent", missing => {
    const building = site(missing);
    for (let contact = 0; contact < 220; contact++) applyConstructionContact(building);
    expect(building.construction).toBeLessThan(1); expect(constructionSupplied(building)).toBe(false);
    expect(building.constructionConsumed![missing]).toBe(19);
  });

  it("preserves ordinary two-ware contact layouts exactly", () => {
    expect(constructionStockLayout({ planks: 4, stone: 6 }, "planks", 3, 6, 5)).toEqual({
      x: -2.64, z: 1.9, layer: 3, slot: 3, approach: { x: -2.64, z: 2.77 }
    });
    expect(constructionStockLayout({ planks: 4, stone: 6 }, "stone", 5, 6, 5)).toEqual({
      x: 1.9200000000000002, z: 1.9, layer: 1, slot: 5, approach: { x: 1.9200000000000002, z: 2.77 }
    });
  });

  it("renders representative material props at the same rotated physical contacts while retaining200required units", () => {
    const world = huntingWorld(), stockContact = createIslandStockContacts(world);
    const plan = createConstructionPlan(getBuildingDefinition(7), false);
    plan.update({ construction: .1, inputStock: cost });
    const matrix = new Matrix4();
    for (const ware of wares) {
      const mesh = plan.root.children.find(child => child.userData.constructionWare === ware)!;
      expect(mesh.userData.capacity).toBe(6);
      expect(mesh.userData.requiredCapacity).toBe(20);
      for (const rotation of [0, 1, 2, 3]) for (const slot of [0, 10, 19]) {
        const building = { ...site(), rotation };
        const contact = stockContact(building, "input", ware, slot)!;
        expect(contact).not.toBeNull();
        (mesh as import("three").InstancedMesh).getMatrixAt(Math.min(slot, 5), matrix);
        const [x, , z] = matrix.elements.slice(12, 15);
        const yaw = rotation * Math.PI / 2, cosine = Math.round(Math.cos(yaw)), sine = Math.round(Math.sin(yaw));
        expect(contact.stock.x).toBeCloseTo(building.x + x! * cosine + z! * sine, 5);
        expect(contact.stock.z).toBeCloseTo(building.z - x! * sine + z! * cosine, 5);
        const local = constructionStockLayout(cost, ware, slot, 9, 9)!;
        expect(Math.abs(local.approach.x) >= 4.7 || Math.abs(local.approach.z) >= 4.7).toBe(true);
        expect(!(Math.abs(local.x) < 1 && local.z > 3)).toBe(true);
      }
    }
    plan.dispose();
  });
});
