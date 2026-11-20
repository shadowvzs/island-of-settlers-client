import { expect, it } from "vitest";

import { adventureBanditStyle, adventureProjectileVisual } from "../src/render-common/workers/adventure-bandit-style";
import { javelinHeld, javelinPose } from "../src/renderers/three/worker-javelin-pose";
import { ADVENTURE_THEMES } from "../src/shared/settlement/adventure-themes";

it("keeps legacy adventures and all player projectiles on existing visuals", () => {
  expect(adventureBanditStyle(4)).toBeUndefined();
  expect(adventureProjectileVisual(4, 1)).toBe("arrow");
  for (const theme of ADVENTURE_THEMES) for (let actor = 1; actor <= 20; actor++)
    expect(adventureProjectileVisual(actor, 0, theme)).toBe("arrow");
});

it.each(ADVENTURE_THEMES)("keeps %s appearance deterministic and shares its bounded variants", theme => {
  const styles = Array.from({ length: 64 }, (_, actor) => adventureBanditStyle(actor, theme)!);
  expect(new Set(styles).size).toBe(4);
  expect(new Set(styles.map(style => style.rangedWeapon))).toEqual(new Set(["bow", "javelin"]));
  for (let actor = 0; actor < styles.length; actor++) {
    expect(adventureBanditStyle(actor, theme)).toBe(styles[actor]);
    expect(adventureProjectileVisual(actor, 1, theme)).toBe(styles[actor]!.rangedWeapon === "javelin" ? "javelin" : "arrow");
  }
});

it("releases the visible javelin at the existing archer hit time and resets between throws", () => {
  expect(javelinHeld(null)).toBe(true); expect(javelinHeld(.749)).toBe(true);
  expect(javelinHeld(.75)).toBe(false); expect(javelinHeld(.9)).toBe(false);
  expect(javelinHeld(.96)).toBe(true);
  for (const p of [null, 0, .25, .55, .75, .9, 1]) {
    const pose = javelinPose(p);
    expect([...pose.leftHand, ...pose.rightHand, pose.pitch, pose.yaw, pose.twist].every(Number.isFinite)).toBe(true);
  }
  expect(javelinPose(null)).toEqual(javelinPose(0));
  expect(javelinPose(.75).rightHand[2]).toBeGreaterThan(javelinPose(.4).rightHand[2]);
});


it("does not lock camp archers with stride-four IDs to one ranged visual", () => {
  for (const theme of ADVENTURE_THEMES) {
    const archers = Array.from({ length: 12 }, (_, index) => adventureBanditStyle(102 + index * 4, theme)!);
    expect(new Set(archers.map(style => style.rangedWeapon))).toEqual(new Set(["bow", "javelin"]));
  }
});


it("retains the bandit headgear while a fallen soldier drops combat weapons", async () => {
  const { fallenSoldierFrame } = await import("../src/render-common/workers/worker-fall");
  const style = adventureBanditStyle(100, "forest");
  const body = { combat: { faction: 1, type: "archer", attackProgress: null, bandit: style } } as
    import("../src/render-common/workers/worker-unit").WorkerFrame;
  const fallen = fallenSoldierFrame(body, .4)!;
  expect(fallen.combat).toBeUndefined(); expect(fallen.workerTool).toBeUndefined();
  expect(fallen.fallenBandit).toBe(style);
});

it("restricts original pirate silhouettes to tropical adventure appearance", () => {
  const tropical = new Set(Array.from({ length: 128 }, (_, id) => adventureBanditStyle(id, "tropical")!.headgear));
  expect(tropical).toEqual(new Set(["tricorn-wide", "tricorn-tall", "bandanna", "headscarf"]));
  for (const theme of ADVENTURE_THEMES.filter(theme => theme !== "tropical"))
    for (let id = 0; id < 128; id++) {
      const style = adventureBanditStyle(id, theme)!;
      expect(style.headgear.startsWith("tricorn-")).toBe(false);
      expect(style.headgear).not.toBe("bandanna");
    }
});

 it("draws a forward-pointing javelin above the shoulder with a raised elbow", () => {
  const drawn = javelinPose(.6), released = javelinPose(.75);
  expect(drawn.rightHand[1]).toBeGreaterThan(1);
  expect(drawn.rightHand[2]).toBeLessThan(0);
  expect(drawn.rightElbow![1]).toBeGreaterThan(0);
  expect(drawn.pitch).toBeGreaterThan(1);
  expect(released.rightHand[1]).toBeGreaterThan(1);
  expect(released.rightHand[2]).toBeGreaterThan(.35);
  expect(released.pitch).toBeLessThan(Math.PI / 2);
});
