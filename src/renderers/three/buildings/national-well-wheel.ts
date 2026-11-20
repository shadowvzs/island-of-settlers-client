import { BoxGeometry, type BufferGeometry, CylinderGeometry, Float32BufferAttribute, Group,
  Mesh, type MeshStandardMaterial, SphereGeometry, TorusGeometry } from "three";

import type { BuildingSurface } from "../../../render-common/buildings/building-recipe";
import type { WorkerNation } from "../../../render-common/workers/worker-nation";

type Materials = Record<BuildingSurface, MeshStandardMaterial>;

/** National moving woodwork around the canonical x-axis; no changes to crank or bucket contacts. */
export const addNationalWellWheel = (wheel: Group, materials: Materials, detailed: boolean,
  nation: Exclude<WorkerNation, "roman">) => {
  const add = (geometry: BufferGeometry, surface: BuildingSurface, name: string) => {
    geometry.setAttribute("color", new Float32BufferAttribute(
      new Float32Array(geometry.getAttribute("position").count * 3).fill(1), 3));
    const object = new Mesh(geometry, materials[surface]);
    object.name = name; object.castShadow = detailed; wheel.add(object);
    return object;
  };
  const spokeCount = { viking: 6, japanese: 4, nubian: 3, chinese: 6,
    persian: 8, maya: 4, indigenous: 2 }[nation];
  const radius = nation === "nubian" ? .205 : .19;
  for (let index = 0; index < spokeCount; index++) {
    const angle = index / spokeCount * Math.PI * 2;
    const broad = nation === "nubian" || nation === "indigenous";
    const spoke = add(new BoxGeometry(.035, radius - .025, broad ? .055 : .026),
      "wood", `well_${nation}_spoke_${index}`);
    spoke.position.set(0, Math.cos(angle) * (radius + .025) / 2,
      Math.sin(angle) * (radius + .025) / 2);
    spoke.rotation.x = angle;
  }
  const rim = (sides: number, reach: number, thickness: number, surface: BuildingSurface,
    phase = 0, x = 0) => {
    for (let index = 0; index < sides; index++) {
      const a = phase + index / sides * Math.PI * 2, b = phase + (index + 1) / sides * Math.PI * 2;
      const ay = Math.cos(a) * reach, az = Math.sin(a) * reach;
      const by = Math.cos(b) * reach, bz = Math.sin(b) * reach;
      const beam = add(new BoxGeometry(.036, Math.hypot(by - ay, bz - az) + thickness * .3, thickness),
        surface, `well_${nation}_rim_${index}`);
      beam.position.set(x, (ay + by) / 2, (az + bz) / 2);
      beam.rotation.x = Math.atan2(bz - az, by - ay);
    }
  };
  if (nation === "viking") rim(6, radius, .034, "wood");
  if (nation === "japanese") rim(4, .205, .036, "wood", Math.PI / 4);
  if (nation === "chinese") {
    rim(detailed ? 12 : 6, .2, .022, "wood");
    rim(detailed ? 12 : 6, .169, .014, "wood", 0, -.012);
  }
  if (nation === "persian") rim(8, .2, .022, "copper", Math.PI / 8);
  if (nation === "maya") {
    rim(4, .215, .034, "wood");
    if (detailed) for (let index = 0; index < 4; index++) {
      const angle = index * Math.PI / 2;
      const block = add(new BoxGeometry(.049, .048, .048), "wood", "well_maya_corner_joint");
      block.position.set(-.006, Math.cos(angle) * .215, Math.sin(angle) * .215);
    }
  }
  const hubSurfaces: Partial<Record<WorkerNation, BuildingSurface>> = { persian: "copper", chinese: "gold" };
  const hubSurface = hubSurfaces[nation] ?? "wood";
  const hub = add(new CylinderGeometry(.056, .056, .08, detailed ? 10 : 5), hubSurface,
    `well_${nation}_hub`);
  hub.rotation.z = Math.PI / 2;
  if (nation === "nubian" || nation === "indigenous") {
    const binding = add(new TorusGeometry(.058, .009, detailed ? 5 : 3, detailed ? 12 : 6),
      "rope", `well_${nation}_hub_lashing`);
    binding.rotation.y = Math.PI / 2;
  }
  if (detailed && ["viking", "persian", "chinese"].includes(nation)) {
    for (let index = 0; index < spokeCount; index++) {
      const angle = index / spokeCount * Math.PI * 2;
      const stud = add(new SphereGeometry(.009, 5, 3), nation === "viking" ? "iron" : "gold",
        `well_${nation}_rim_pin`);
      stud.position.set(-.025, Math.cos(angle) * radius, Math.sin(angle) * radius);
    }
  }
  // Drum cheeks sit outside the chain/rope winding interval, never through its moving coils.
  for (const side of [-1, 1]) {
    const cheek = add(new CylinderGeometry(nation === "nubian" ? .078 : .066,
      nation === "nubian" ? .078 : .066, .018, detailed ? 12 : 6),
    nation === "persian" ? "copper" : "wood", `well_${nation}_drum_cheek`);
    cheek.rotation.z = Math.PI / 2;
    cheek.position.x = .52 + side * .064;
  }
};
