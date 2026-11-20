import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Raycaster, Scene, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { createShipInteraction } from "../src/renderers/three/settlement/ship-interaction";
import type { MilitaryTroopType } from "../src/shared/settlement/military-combat-rules";
import {
  countNavalPassengerJobs, countNavalPassengerTroops
} from "../src/shared/settlement/settlement-naval-fleet";

describe("ship selection and manifest", () => {
  it("picks visible completed vessels, moves the outline with them and restores shared materials", () => {
    const scene = new Scene(), group = new Group(), ship = new Group();
    ship.name = "ship-7"; group.add(ship); scene.add(group);
    const geometry = new BoxGeometry(), material = new MeshStandardMaterial({ color: "#804020" });
    const hull = new Mesh(geometry, material); ship.add(hull);
    const sail = new Mesh(geometry, material); sail.name = "ship_sail"; sail.position.y = 2; ship.add(sail);
    const cargo = new Group(); cargo.name = "ship_cargo"; cargo.position.y = 3;
    cargo.add(new Mesh(geometry, material)); ship.add(cargo);
    const site = new Group(); site.name = "site-9"; site.position.x = -3;
    site.add(new Mesh(geometry, material)); group.add(site); scene.updateMatrixWorld(true);
    const interaction = createShipInteraction(scene, group);
    const ray = new Raycaster(new Vector3(0, 0, 10), new Vector3(0, 0, -1));
    expect(interaction.pick(ray)).toBe("7");
    interaction.setHover("7");
    expect(hull.material).not.toBe(material); expect(material.color.r).toBeCloseTo(.21586, 4);
    const outline = ship.getObjectByName("ship_hover_outline") as Mesh;
    expect(outline.parent).toBe(ship);
    expect(interaction.getStats().triangles).toBe(12);
    ship.position.x = 5; ship.rotation.y = .8; scene.updateMatrixWorld(true);
    expect(outline.getWorldPosition(new Vector3()).x).toBe(5);
    expect(interaction.pick(ray)).toBeNull();
    ray.ray.origin.x = -3; expect(interaction.pick(ray)).toBeNull();
    ship.visible = false; ray.ray.origin.x = 5; expect(interaction.pick(ray)).toBeNull();
    interaction.setHover(null); expect(hull.material).toBe(material);
    expect(ship.getObjectByName("ship_hover_outline")).toBeUndefined();
    interaction.dispose(); geometry.dispose(); material.dispose();
  });

  it("counts embarked helpers and soldiers without counting shore workers or duplicate actor ids", () => {
    expect(countNavalPassengerJobs([2, 4, 5, 5], [
      { uid: 1, job: "Carrier" }, { uid: 2, job: "Settler" },
      { uid: 4, job: "Soldier" }, { uid: 5, job: "Soldier" }
    ])).toEqual({ Settler: 1, Soldier: 2 });
  });

  it("counts embarked soldiers per troop type once and skips civilians", () => {
    const types = new Map<number, MilitaryTroopType>([[4, "archer"], [5, "cavalry"], [6, "archer"]]);
    expect(countNavalPassengerTroops([2, 4, 5, 5, 6], uid => types.get(uid)))
      .toEqual({ archer: 2, cavalry: 1 });
    expect(countNavalPassengerTroops([4, 5])).toEqual({});
  });
});
