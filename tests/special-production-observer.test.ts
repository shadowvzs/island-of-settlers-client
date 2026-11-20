import { afterEach, describe, expect, it, vi } from "vitest";

import { MATERIAL_BUILDING_GROUPS } from "../src/shared/settlement/advanced-material-production";
import { PROP } from "../src/shared/world/world-data";
import { createSpecialProductionObserver } from "../tools/e2e/full/special-production-observer";

afterEach(() => vi.unstubAllGlobals());

describe("forestry evidence for colony species", () => {
  it.each([PROP.hardwoodTree, PROP.cedarTree, PROP.walnutTree, PROP.mahoganyTree])(
    "attributes new tree kind %s and waits for actual maturity", kind => {
      let nextFrame: (() => void) | undefined;
      vi.stubGlobal("requestAnimationFrame", (callback: () => void) => { nextFrame = callback; return 1; });
      let grown = false;
      const props = { count: 0, types: [kind], x: [4], z: [5] };
      const live = { world: { props }, settlement: {
        simulation: { buildings: () => [{ uid: 7 }], frames: () => [
          { building: 7, target: { kind: "plant", x: 4, z: 5 } }
        ] }, growth: { isGrowing: () => !grown, isGrown: () => grown }
      } };
      const observer = createSpecialProductionObserver(live, 7, MATERIAL_BUILDING_GROUPS[0]!.forester, "");
      props.count = 1; nextFrame!();
      expect(observer.read().completed).toBe(0);
      grown = true; nextFrame!();
      expect(observer.read().completed).toBe(1);
      expect(observer.read().proofs).toEqual([expect.objectContaining({ id: 0, target: { x: 4, z: 5 } })]);
      observer.stop();
    }
  );
});
