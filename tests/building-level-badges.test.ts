import { InstancedMesh, PerspectiveCamera } from "three";
import { describe, expect, it } from "vitest";

import { buildingLevelOf, upgradedBuildingLevel } from "../src/render-common/buildings/levels/building-level";
import { createBuildingLevelBadges, hoveredBuildingLevel } from "../src/renderers/three/buildings/building-level-badges";
import { buildingLevelDigitParts } from "../src/renderers/three/buildings/building-level-digits";
import { createBuildingPauseBadges } from "../src/renderers/three/buildings/building-pause-badges";

const frame = { id: "home", construction: 1, owner: 0 };

describe("hovered world building levels", () => {
  it("matches the panel's actual achieved levels including the unupgraded base", () => {
    for (let upgrade = 0; upgrade <= 4; upgrade++) {
      const level = hoveredBuildingLevel({ ...frame, level: upgradedBuildingLevel(upgrade) }, "home");
      expect(level).toBe(buildingLevelOf(upgrade));
      expect(String(level)).toBe(String(upgrade + 1));
    }
    // An in-progress next upgrade leaves the render frame's achieved level unchanged.
    expect(hoveredBuildingLevel({ ...frame, level: 2 }, "home")).toBe(2);
  });

  it("hides on pointer leave, another building, construction, demolition and non-player ownership", () => {
    expect(hoveredBuildingLevel(frame, null)).toBeNull();
    expect(hoveredBuildingLevel(frame, "another")).toBeNull();
    expect(hoveredBuildingLevel({ ...frame, construction: .7 }, "home")).toBeNull();
    expect(hoveredBuildingLevel(frame, "home", true)).toBeNull();
    expect(hoveredBuildingLevel({ ...frame, owner: 1 }, "home")).toBeNull();
  });

  it.each([true, false])("shows only the actual digit, clears immediately and reuses cached geometry (%s)", detailed => {
    const badges = createBuildingLevelBadges(detailed), camera = new PerspectiveCamera();
    const geometryIds: string[] = [];
    badges.root.traverse(object => { if (object instanceof InstancedMesh) geometryIds.push(object.geometry.uuid); });
    for (let upgrade = 0; upgrade <= 4; upgrade++) {
      const level = buildingLevelOf(upgrade);
      badges.update([{ level, phase: 0, x: 1, y: 2, z: 3 }], 0);
      badges.faceCamera(camera);
      const visible = badges.root.children.filter(group => group.children.some(child => child.visible));
      expect(visible.map(group => group.name)).toEqual([`building_${level}_badges`]);
      for (const child of visible[0]!.children) expect((child as InstancedMesh).count).toBe(1);
    }
    badges.update([], 0); badges.faceCamera(camera);
    const after: string[] = [];
    badges.root.traverse(object => {
      if (object instanceof InstancedMesh) { expect(object.visible).toBe(false); after.push(object.geometry.uuid); }
    });
    expect(after).toEqual(geometryIds);
    badges.dispose();
  });

  it("uses five distinct Arabic glyphs while keeping pause markers independent", () => {
    const signatures = new Set<string>();
    for (let upgrade = 0; upgrade <= 4; upgrade++) {
      const parts = buildingLevelDigitParts(buildingLevelOf(upgrade));
      signatures.add(JSON.stringify(parts.map(part => [...part.getAttribute("position").array])));
      parts.forEach(part => part.dispose());
    }
    expect(signatures.size).toBe(5);
    const pause = createBuildingPauseBadges(false);
    pause.update([{ phase: 0, x: 0, y: 0, z: 0 }], 0); pause.faceCamera(new PerspectiveCamera());
    expect(pause.root.children.every(child => child.visible && (child as InstancedMesh).count === 1)).toBe(true);
    pause.dispose();
  });
});
