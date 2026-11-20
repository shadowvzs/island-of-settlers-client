import { expect, it } from "vitest";

import { militaryContactReach } from "../src/shared/settlement/military-contact";

it("uses the visible defender body, not a cavalry roster identity, for horse contact reach", () => {
  const source = { x: 0, z: 0 };
  const target = { x: 0, z: 1, yaw: 0 };
  expect(militaryContactReach("shield", .9, source, "cavalry", target)).toBe(.9);
  expect(militaryContactReach("shield", .9, source, "cavalry", { ...target, mounted: false })).toBe(.9);
  expect(militaryContactReach("shield", .9, source, "cavalry", { ...target, mounted: true })).toBeGreaterThan(.9);
  expect(militaryContactReach("archer", 8, source, "cavalry", { ...target, mounted: true })).toBe(8);
});

it("allows a mounted axe to contact a foot foe without penetrating the canonical horse clearance", () => {
  const source = { mounted: true, x: 0, z: 0 };
  const target = { mounted: false, x: 0, z: 1.29, yaw: 0 };
  expect(militaryContactReach("heavy", 1, source, "shield", target)).toBe(1.29);
  expect(militaryContactReach("cavalry", 1.5, source, "shield", target)).toBe(1.5);
  expect(militaryContactReach("heavy", 1, { ...source, mounted: false }, "shield", target)).toBe(1);
});
