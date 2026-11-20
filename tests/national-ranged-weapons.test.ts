import { Box3, type BufferGeometry, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { adventureBanditStyle } from "../src/render-common/workers/adventure-bandit-style";
import { hasDualTomahawks, rangedProjectileStyle, rangedWeaponStyle } from "../src/render-common/workers/military-weapon-style";
import type { WorkerFrame } from "../src/render-common/workers/worker-unit";
import { countTriangles } from "../src/renderers/three/military-equipment-mesh";
import { buildChineseCrossbow, buildCrossbowBolt, buildExpansionBow, buildMayaJavelin } from "../src/renderers/three/military-expansion-ranged";
import { crossbowLoadState, crossbowPose } from "../src/renderers/three/worker-crossbow-pose";
import { dualTomahawkPose } from "../src/renderers/three/worker-dual-tomahawk-pose";
import { javelinHeld } from "../src/renderers/three/worker-javelin-pose";
import { meleePose } from "../src/renderers/three/worker-melee-moves";

const bounds = (geometry: BufferGeometry) => {
  geometry.computeBoundingBox();
  return geometry.boundingBox!;
};

describe("national ranged equipment and independent axe grips", () => {
  it("selects nation weapons while retaining adventure enemies' explicit weapon styles", () => {
    expect(rangedProjectileStyle("maya")).toBe("javelin");
    expect(rangedProjectileStyle("chinese")).toBe("bolt");
    for (const nation of ["roman", "viking", "japanese", "nubian", "indigenous", "persian"] as const)
      expect(rangedWeaponStyle(nation)).toBe("bow");
    for (let actor = 0; actor < 12; actor++) {
      const bandit = adventureBanditStyle(actor, "forest")!;
      expect(rangedWeaponStyle("chinese", bandit)).toBe(bandit.rangedWeapon);
      expect(rangedWeaponStyle("maya", bandit)).toBe(bandit.rangedWeapon);
    }
    expect(hasDualTomahawks("indigenous", "heavy")).toBe(true);
    expect(hasDualTomahawks("indigenous", "shield")).toBe(false);
  });

  it("keeps a visible loaded crossbow before firing and releases its bolt at the shared hit", () => {
    expect(crossbowLoadState(null)).toEqual({ bolt: false, tension: 0 });
    expect(crossbowLoadState(.6)).toEqual({ bolt: true, tension: 1 });
    expect(crossbowLoadState(.75).bolt).toBe(false);
    expect(crossbowLoadState(.8)).toEqual({ bolt: false, tension: 0 });
    expect(crossbowLoadState(.2).bolt).toBe(false);
    expect(javelinHeld(.749)).toBe(true);
    expect(javelinHeld(.75)).toBe(false);
    expect(javelinHeld(.96)).toBe(true);
  });

  it("gives the crossbow two separate hand contacts and finite closed-cycle reload targets", () => {
    const ready = crossbowPose(null);
    expect(ready.leftHand[2] - ready.rightHand[2]).toBeCloseTo(.18);
    for (let step = 0; step <= 100; step++) {
      const pose = crossbowPose(step / 100);
      expect([...pose.leftHand, ...pose.rightHand].every(Number.isFinite)).toBe(true);
      expect(new Vector3(...pose.leftHand).distanceTo(new Vector3(...pose.rightHand))).toBeLessThan(.3);
    }
    expect(crossbowPose(0)).toEqual(crossbowPose(1));
  });

  it("rocks the crossbow body back after the release instead of firing from a frozen torso", () => {
    const draw = crossbowPose(.6), recoil = crossbowPose(.84);
    expect(recoil.bend).toBeLessThan(draw.bend - .1);
    expect(recoil.body!.shift).toBeLessThan(draw.body!.shift - .02);
    expect(recoil.body!.drop).toBeGreaterThan(draw.body!.drop);
  });

  it("holds one tomahawk in each separated hand and alternates the leading attack", () => {
    for (const variant of [0, 1]) for (const progress of [null, 0, .4, .75, .9, 1]) {
      const pose = dualTomahawkPose(progress, variant, false);
      expect(pose.leftHand[0]).toBeGreaterThan(0);
      expect(pose.rightHand[0]).toBeLessThan(0);
      expect(pose.leftAlong).toBeUndefined();
      expect(pose.shield).toBe(false);
    }
    const frame = { nation: "indigenous", combat: { attackProgress: .75, faction: 0, type: "heavy", variant: 0 } } as WorkerFrame;
    const right = meleePose(frame)!;
    frame.combat!.variant = 1;
    const left = meleePose(frame)!;
    expect(right.pitch).toBeCloseTo(left.leftPitch!);
    expect(right.leftPitch).toBeCloseTo(left.pitch);
  });

  it("bakes detailed and inexpensive closed-mesh variants into the existing shared equipment atlas", () => {
    for (const detailed of [true, false]) {
      const geometries = [buildChineseCrossbow(detailed), buildMayaJavelin(detailed),
        buildExpansionBow("persian", detailed), buildExpansionBow("indigenous", detailed),
        buildCrossbowBolt(detailed)];
      for (const geometry of geometries) {
        expect(countTriangles(geometry)).toBeLessThan(detailed ? 1600 : 600);
        const position = geometry.getAttribute("position");
        expect([...position.array].every(Number.isFinite)).toBe(true);
        for (const name of ["normal", "color", "uv", "equipmentSurface"])
          expect(geometry.getAttribute(name).count).toBe(position.count);
        expect(geometry.groups).toHaveLength(0);
        expect(new Box3().copy(bounds(geometry)).getSize(new Vector3()).length()).toBeLessThan(1.6);
        geometry.dispose();
      }
    }
  });
});
