import { describe, expect, it } from "vitest";

import { GARRISON_POST_MAX_RANGE_FACTOR, MILITARY_PROFILES } from "../src/shared/balance/military";
import {
  exposedGarrisonArchers, garrisonArcherReach, garrisonArcherTarget, postRangeFactor
} from "../src/shared/settlement/settlement-garrison-archers";
import type { SettlementSoldier } from "../src/shared/settlement/settlement-military";
import type { SettlementContext } from "../src/shared/settlement/settlement-types";

const soldier = (actor: number, type: "archer" | "shield", faction = 0): SettlementSoldier =>
  ({ actor, building: 7, combat: { cooldown: 0, faction, hp: 56.25, type }, rank: 0, stationed: true });
const context = (typeId: number) => ({
  buildings: [{ construction: 1, depth: 4, rotation: 0, typeId, uid: 7, width: 5, x: 20, y: 1, z: 20 }],
  playerNation: "roman"
}) as unknown as SettlementContext;
const enemy = (x: number, z: number, y = 1) => ({ soldier: soldier(99, "shield", 1), x, y, z });
const BASE = MILITARY_PROFILES.archer.range;
const exposed = (typeId: number, garrison: SettlementSoldier[]) =>
  exposedGarrisonArchers(context(typeId), new Map(garrison.map(entry => [entry.actor, entry])));

describe("garrison archers", () => {
  it("expose only archers: tower posts first, then windows", () => {
    const archers = exposed(2, [soldier(1, "archer"), soldier(2, "archer"), soldier(3, "archer"), soldier(4, "shield")]);
    expect(archers.map(entry => [entry.soldier.actor, entry.facing === null]))
      .toEqual([[1, true], [2, true], [3, false]]);
    expect(archers[0]!.origin.y).toBeGreaterThan(4);
  });

  it("shoot all around from a tower post but never at enemies under the walls", () => {
    const [post] = exposed(4, [soldier(1, "archer")]);
    expect(garrisonArcherTarget(post!, [enemy(20, 34)])).toBeUndefined();
    expect(garrisonArcherTarget(post!, [enemy(25, 20)])).toBeDefined();
    expect(garrisonArcherTarget(post!, [enemy(14, 20)])).toBeDefined();
    expect(garrisonArcherTarget(post!, [enemy(23, 20)])).toBeUndefined();
  });

  it("shoot from a window only inside its 60 degree cone", () => {
    const [window] = exposed(1, [soldier(1, "archer")]);
    const side = Math.sign(Math.sin(window!.facing!));
    expect(garrisonArcherTarget(window!, [enemy(20 + side * 6, 20)])).toBeDefined();
    expect(garrisonArcherTarget(window!, [enemy(20 + side * 6, 22)])).toBeDefined();
    expect(garrisonArcherTarget(window!, [enemy(20 + side * 6, 23.5)])).toBeUndefined();
    expect(garrisonArcherTarget(window!, [enemy(20 + side * 6, 28)])).toBeUndefined();
    expect(garrisonArcherTarget(window!, [enemy(20 - side * 6, 20)])).toBeUndefined();
  });

  it("never shoot at their own side", () => {
    const [post] = exposed(4, [soldier(1, "archer")]);
    expect(garrisonArcherTarget(post!, [{ ...enemy(25, 20), soldier: soldier(5, "shield", 0) }])).toBeUndefined();
  });

  it("reach from a post grows with its height above the target's ground, up to the cap (owner request 2026-10-19)", () => {
    expect(postRangeFactor(0)).toBe(1);
    expect(postRangeFactor(-3)).toBe(1);
    expect(postRangeFactor(.1)).toBeGreaterThan(1);
    expect(postRangeFactor(.3)).toBeGreaterThan(postRangeFactor(.1));
    expect(postRangeFactor(.3)).toBeLessThan(GARRISON_POST_MAX_RANGE_FACTOR);
    // The arrow's own ballistics: vx = 10, vy = g·8/(2·10) = 3.92 lands the level shot at 8 tiles.
    expect(postRangeFactor(.3)).toBeCloseTo((1 + Math.sqrt(1 + 2 * 9.8 * .3 / 3.92 ** 2)) / 2, 6);
    expect(postRangeFactor(40)).toBe(GARRISON_POST_MAX_RANGE_FACTOR);
    // Level ground: a post archer standing on the ground keeps the base range.
    expect(garrisonArcherReach({ facing: null, floor: 3 }, 3)).toBe(BASE);
    expect(garrisonArcherReach({ facing: null, floor: 3.5 }, 3)).toBeGreaterThan(BASE);
    expect(garrisonArcherReach({ facing: null, floor: 3 }, 5)).toBe(BASE);
    expect(garrisonArcherReach({ facing: null, floor: 30 }, 0)).toBe(BASE * GARRISON_POST_MAX_RANGE_FACTOR);
  });

  it("window archers keep the base range at any height", () => {
    expect(garrisonArcherReach({ facing: 0, floor: 30 }, 0)).toBe(BASE);
    const [window] = exposed(4, [soldier(1, "archer"), soldier(2, "archer"), soldier(3, "archer"), soldier(4, "archer")])
      .filter(entry => entry.facing !== null);
    expect(window!.floor).toBeGreaterThan(2);
    expect(garrisonArcherReach(window!, 1)).toBe(BASE);
    const out = { x: Math.sin(window!.facing!), z: Math.cos(window!.facing!) };
    const at = (distance: number) => enemy(window!.origin.x + out.x * distance, window!.origin.z + out.z * distance);
    expect(garrisonArcherTarget(window!, [at(BASE - .2)])).toBeDefined();
    expect(garrisonArcherTarget(window!, [at(BASE + .5)])).toBeUndefined();
  });

  it("a watchtower post shoots beyond the base range, less far at targets up a hill", () => {
    const [post] = exposed(4, [soldier(1, "archer")]);
    const reach = garrisonArcherReach(post!, 1);
    expect(reach).toBe(BASE * GARRISON_POST_MAX_RANGE_FACTOR);
    const at = (distance: number, y = 1) => enemy(post!.origin.x + distance, post!.origin.z, y);
    expect(garrisonArcherTarget(post!, [at(reach - .1)])).toBeDefined();
    expect(garrisonArcherTarget(post!, [at(reach + .1)])).toBeUndefined();
    // On a hill as high as the post's floor, the post has no height advantage left.
    expect(garrisonArcherTarget(post!, [at(BASE + .4, post!.floor)])).toBeUndefined();
    // A little lower, part of it: the reach follows the height above the target's ground.
    const near = garrisonArcherReach(post!, post!.floor - .1);
    expect(near).toBeGreaterThan(BASE);
    expect(near).toBeLessThan(reach);
    expect(garrisonArcherTarget(post!, [at(BASE - .2, post!.floor)])).toBeDefined();
  });

  it("keeps the dead zone under the walls, however high the post", () => {
    const [post] = exposed(9, [soldier(1, "archer")]);
    expect(garrisonArcherReach(post!, 1)).toBeGreaterThan(BASE);
    // Fortress footprint is 5 x 4 around (20, 20): 1.5 tiles out stays sheltered.
    expect(garrisonArcherTarget(post!, [enemy(20, 23.5)])).toBeUndefined();
    expect(garrisonArcherTarget(post!, [enemy(26.6, 20)])).toBeDefined();
  });
});
