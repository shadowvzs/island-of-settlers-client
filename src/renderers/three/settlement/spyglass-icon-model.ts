import {
  type BufferGeometry, CatmullRomCurve3, Color, Group, LatheGeometry, Mesh, MeshPhysicalMaterial,
  MeshStandardMaterial, SphereGeometry, TubeGeometry, Vector2, Vector3
} from "three";

import { spyglassParts } from "../../../render-common/wares/spyglass-parts";
import { createHollowRingGeometry } from "../buildings/roman-hollow-ring";

/** Fine rolled shoulders on the brass draw tubes catch the same native icon lights as the collar rims. */
const turnedTube = () => new LatheGeometry([
  [0, -.5], [.46, -.5], [.5, -.44], [.5, .44], [.46, .5], [0, .5]
].map(([radius, y]) => new Vector2(radius, y)), 48);

/** Two curved coating reflections on the recessed convex objective glass, visible at inventory size. */
const addLensReflections = (root: Group, y: number, diameter: number, material: MeshStandardMaterial) => {
  for (const [from, to, radius, width] of [[.35, 1.1, .31, .009], [2.6, 3, .29, .005]]) {
    const points = Array.from({ length: 9 }, (_, step) => {
      const angle = from! + (to! - from!) * step / 8, r = diameter * radius!;
      return new Vector3(Math.cos(angle) * r, y + .003 * Math.sqrt(1 - 4 * radius! ** 2) + .0003, Math.sin(angle) * r);
    });
    const streak = new Mesh(new TubeGeometry(new CatmullRomCurve3(points), 16, diameter * width!, 5, false), material);
    root.add(streak);
  }
};

/** The canonical telescope enlarged for inventory: polished brass, charcoal grip and coated glass. */
export const createSpyglassIconModel = () => {
  const root = new Group();
  root.name = "ware_icon_spyglass";
  const materials = new Map<string, MeshStandardMaterial>();
  const reflection = new MeshStandardMaterial({ color: "#c5e8e7", emissive: "#457e88", emissiveIntensity: .25,
    metalness: .2, roughness: .16 });
  materials.set("reflection", reflection);
  for (const part of spyglassParts(true)) {
    const key = `${part.surface}:${part.tint?.join(":")}`, brass = part.surface === "gold";
    const glass = part.surface === "steel";
    let material = materials.get(key);
    if (!material) {
      material = new MeshPhysicalMaterial({
        clearcoat: glass ? 1 : .25, clearcoatRoughness: .08,
        color: new Color(...part.tint!), metalness: brass ? .88 : .08,
        roughness: brass ? .22 : .7
      });
      if (glass) {
        material.color.set("#102c37");
        material.roughness = .06;
      }
      materials.set(key, material);
    }
    let geometry: BufferGeometry = turnedTube();
    if (part.shape === "ring") { geometry.dispose(); geometry = createHollowRingGeometry(48); }
    if (glass) { geometry.dispose(); geometry = new SphereGeometry(.5, 48, 16); }
    const mesh = new Mesh(geometry, material);
    mesh.position.fromArray(part.position);
    mesh.scale.fromArray(part.size);
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
    if (glass && part.position[1] > 0) addLensReflections(root, part.position[1], part.size[0], reflection);
  }
  root.rotation.set(.35, .3, -.9);
  const triangles = () => root.children.reduce((count, child) => {
    const mesh = child as Mesh;
    return count + (mesh.geometry.index?.count ?? mesh.geometry.attributes.position!.count) / 3;
  }, 0);
  const dispose = () => {
    for (const child of root.children) (child as Mesh).geometry.dispose();
    for (const material of materials.values()) material.dispose();
    root.removeFromParent();
  };
  return { dispose, recipe: { framingMargin: 1.06, framingShadow: true, tightFraming: true, tool: false },
    root, triangles };
};
