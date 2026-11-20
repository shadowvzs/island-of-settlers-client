import {
  BoxGeometry, BufferGeometry, CylinderGeometry, DoubleSide, ExtrudeGeometry, Float32BufferAttribute,
  Group, IcosahedronGeometry, Mesh, MeshStandardMaterial, Shape, SphereGeometry, TorusGeometry, Vector3
} from "three";

import { HANDCART_OUTPUT } from "../../../render-common/logistics/handcart-rules";
import type { createRomanMaterials } from "../buildings/roman-materials";
import { disposeMeshGeometries } from "../three-mesh-resources";
import { createBeerIconModel } from "./beer-icon-model";
import { createFlourIconModel, createWheatIconModel } from "./food-icon-models";
import { createHotCrucibleIconModel } from "./hot-crucible-icon-model";
import { createIronBarIconModel } from "./iron-bar-icon-model";
import { createRomanHandcart } from "./roman-handcart";
import { createTimberIconModel, isTimberIcon } from "./timber-log-icon-model";
import { createWareModel } from "./ware-models";
import { createToolIconModel, ICON_TOOL_WARES } from "./ware-tool-icon-models";

/** The real game cart (High detail) in a three-quarter view, as the Sawmill's hand-cart mode icon. */
type OreIconWare = "coal" | "goldOre" | "ironOre";
/** Host rock and vein colours of the ore ware icons; only the gold vein is metallic. */
const ORE_ICON_LOOKS: Readonly<Record<OreIconWare, {
  stone: string; stoneRoughness: number; vein: string; veinMetalness: number; veinRoughness: number;
}>> = {
  coal: { stone: "#141719", stoneRoughness: .62, vein: "#536068", veinMetalness: .12, veinRoughness: .6 },
  goldOre: { stone: "#b98620", stoneRoughness: .65, vein: "#fce276", veinMetalness: .8, veinRoughness: .28 },
  ironOre: { stone: "#654b39", stoneRoughness: .9, vein: "#b0663b", veinMetalness: .12, veinRoughness: .6 }
};

const createHandcartIconModel = () => {
  const cart = createRomanHandcart(true);
  cart.root.rotation.y = 2.4;
  return { ...cart, recipe: { framingMargin: 1.04, tightFraming: true, tool: false } };
};

/** Icon-specific presentation: unpacked minerals and clearly different leather processing stages. */
export const createWareIconModel = (id: string, materials: ReturnType<typeof createRomanMaterials>["materials"]) => {
  if (isTimberIcon(id)) return createTimberIconModel(id, materials);
  if (id === "grain") return createWheatIconModel();
  if (id === "flour") return createFlourIconModel();
  if (id === "beer") return createBeerIconModel();
  if (id === "iron") return createIronBarIconModel(materials);
  if (id === HANDCART_OUTPUT) return createHandcartIconModel();
  if (id === "crucible") return createHotCrucibleIconModel();
  if (ICON_TOOL_WARES.has(id)) return createToolIconModel(id);
  if (id === "flax" || id === "cloth")
    return { ...createWareModel(id, true, materials),
      recipe: { framingMargin: 1.08, tightFraming: true, tool: false } };
  if (!["goldOre", "ironOre", "coal", "hides", "leather", "armor"].includes(id))
    return createWareModel(id, true, materials);
  const root = new Group(); root.name = `ware_icon_${id}`;
  const owned: MeshStandardMaterial[] = [];
  const material = (color: string, roughness = .8, metalness = 0) => {
    const result = new MeshStandardMaterial({ color, roughness, metalness, side: DoubleSide });
    owned.push(result); return result;
  };
  const add = (geometry: BufferGeometry, surface: MeshStandardMaterial, position: number[] = [0, 0, 0], scale?: number[]) => {
    const mesh = new Mesh(geometry, surface); mesh.position.set(position[0]!, position[1]!, position[2]!);
    if (scale) mesh.scale.set(scale[0]!, scale[1]!, scale[2]!);
    mesh.castShadow = mesh.receiveShadow = true; root.add(mesh); return mesh;
  };
  const hide = material("#a4774a"), leather = material("#92552b", .65), edge = material("#d0a56c");
  const dark = material("#42291e"), gold = material("#cfa452", .35, .7);
  if (["goldOre", "ironOre", "coal"].includes(id)) {
    const look = ORE_ICON_LOOKS[id as OreIconWare];
    const stone = material(look.stone, look.stoneRoughness);
    const vein = material(look.vein, look.veinRoughness, look.veinMetalness);
    for (let rock = 0; rock < 5; rock++) {
      const geometry = new IcosahedronGeometry(1, 2), positions = geometry.getAttribute("position");
      for (let vertex = 0; vertex < positions.count; vertex++) {
        const x = positions.getX(vertex), y = positions.getY(vertex), z = positions.getZ(vertex);
        const relief = 1 + .14 * Math.sin(x * 9 + rock * 2) * Math.cos(z * 7) + .09 * Math.sin(y * 11 + x * 4);
        positions.setXYZ(vertex, x * relief, y * relief, z * relief);
      }
      geometry.computeVertexNormals();
      const center = new Vector3((rock % 3 - 1) * .21, rock > 2 ? .3 : .13, Math.floor(rock / 3) * .23 - .13);
      const size = rock === 3 ? .27 : .20;
      const body = add(geometry, stone, center.toArray(), [size * 1.1, size * .8, size]);
      body.rotation.set(rock * .3, rock * 1.3, rock * .12);
      // Small mineral crystals follow the exposed upper surface, not an unrelated gold bag.
      for (let crystal = 0; crystal < (id === "coal" ? 3 : 12); crystal++) {
        const azimuth = crystal * 2.4 + rock, elevation = .25 + (crystal % 4) * .25;
        const direction = new Vector3(Math.cos(azimuth) * Math.cos(elevation), Math.sin(elevation), Math.sin(azimuth) * Math.cos(elevation));
        const relief = 1 + .14 * Math.sin(direction.x * 9 + rock * 2) * Math.cos(direction.z * 7) +
          .09 * Math.sin(direction.y * 11 + direction.x * 4);
        body.updateMatrixWorld(true);
        const point = body.localToWorld(direction.multiplyScalar(relief * .94));
        const ore = add(new IcosahedronGeometry(.028 + crystal % 3 * .008, 0), vein, point.toArray(), [1.3, .6, .85]);
        ore.rotation.set(crystal * .7, rock + crystal, crystal * .3);
      }
    }
  } else if (id === "hides") {
    const outline = new Shape();
    const points = [[-.25,.30],[-.13,.20],[0,.27],[.13,.20],[.25,.30],[.29,.24],[.22,.10],
      [.20,-.08],[.31,-.27],[.22,-.32],[.08,-.22],[0,-.25],[-.08,-.22],[-.22,-.32],[-.31,-.27],[-.20,-.08],[-.22,.10]];
    points.forEach(([x,z], index) => index ? outline.lineTo(x!, z!) : outline.moveTo(x!, z!)); outline.closePath();
    const pelt = add(new ExtrudeGeometry(outline, { depth: .015, bevelEnabled: true, bevelThickness: .008, bevelSize: .007, bevelSegments: 3, steps: 1 }), hide);
    pelt.rotation.x = -Math.PI / 2; pelt.position.y = .025;
    // Curled edges, mottling and short hair distinguish untreated hide from smooth tanned leather.
    for (let tuft = 0; tuft < 120; tuft++) {
      const x = Math.sin(tuft * 2.4) * .17, z = Math.cos(tuft * 1.7) * .21;
      const hair = add(new CylinderGeometry(.001, .003, .018, 4), tuft % 4 ? hide : edge, [x, .05, z]);
      hair.rotation.z = Math.sin(tuft) * .8;
    }
  } else if (id === "leather") {
    const sheet = add(new BoxGeometry(.48, .018, .40, 12, 1, 12), leather, [0, .026, 0]);
    const position = sheet.geometry.getAttribute("position");
    for (let vertex = 0; vertex < position.count; vertex++)
      position.setY(vertex, position.getY(vertex) + .018 * Math.sin(position.getX(vertex) * 10) * Math.cos(position.getZ(vertex) * 7));
    sheet.geometry.computeVertexNormals();
    const roll = add(new CylinderGeometry(.07, .07, .49, 32), leather, [0, .10, -.16]); roll.rotation.z = Math.PI / 2;
    for (const side of [-1, 1]) {
      const hole = add(new CylinderGeometry(.044, .044, .004, 28), dark, [side * .247, .10, -.16]); hole.rotation.z = Math.PI / 2;
      for (let ring = 0; ring < 3; ring++) {
        const spiral = add(new TorusGeometry(.049 + ring * .006, .003, 5, 28), edge, [side * .25, .10, -.16]);
        spiral.rotation.y = Math.PI / 2;
      }
    }
    for (const x of [-.16,.16]) for (let stitch = 0; stitch < 13; stitch++)
      add(new BoxGeometry(.012,.003,.002), edge, [x,.043,-.10+stitch*.023]);
  } else {
    // A hollow leather cuirass with a neck opening, shoulder straps and Roman skirt strips.
    const geometry = new BufferGeometry(), positions: number[] = [], indices: number[] = [];
    const rings = [[.08,.16,.10],[.20,.15,.09],[.35,.20,.115],[.48,.19,.10]];
    for (const [y,rx,rz] of rings) for (let segment = 0; segment <= 32; segment++) {
      const angle = segment / 32 * Math.PI * 2;
      positions.push(Math.cos(angle) * rx!, y!, Math.sin(angle) * rz!);
    }
    for (let row = 0; row < rings.length - 1; row++) for (let segment = 0; segment < 32; segment++) {
      const a = row * 33 + segment, b = a + 33; indices.push(a,b,a+1,a+1,b,b+1);
    }
    geometry.setAttribute("position", new Float32BufferAttribute(positions,3)); geometry.setIndex(indices); geometry.computeVertexNormals();
    add(geometry, leather);
    for (const x of [-.135,.135]) {
      const shoulder = add(new TorusGeometry(.065,.023,8,24,Math.PI), leather, [x,.48,0]); shoulder.rotation.y = Math.PI / 2;
      for (const z of [-.10,.10]) add(new SphereGeometry(.010,10,6), gold, [x,.455,z]);
    }
    for (let strip = 0; strip < 10; strip++) {
      const angle = strip / 10 * Math.PI * 2;
      const flap = add(new BoxGeometry(.075,.11,.012,2,2,1), strip % 2 ? hide : leather,
        [Math.sin(angle)*.17,.075,Math.cos(angle)*.11]); flap.rotation.y = angle;
      add(new SphereGeometry(.008,8,5), gold, [Math.sin(angle)*.177,.115,Math.cos(angle)*.118]);
    }
    const belt = add(new TorusGeometry(.16,.013,6,32), dark, [0,.20,0],[1,.62,1]); belt.rotation.x = Math.PI / 2;
    // Armory reinforcement: riveted iron bands across the chest, as on the stock and carried ware.
    const iron = material("#8d969b", .35, .85);
    for (const [y, rx, rz] of [[.29, .178, .106], [.35, .2, .115], [.41, .197, .108]] as const) {
      const band = add(new TorusGeometry(1, .011, 6, 40), iron, [0, y, 0], [rx, rz, 1]); band.rotation.x = Math.PI / 2;
      for (const side of [-1, 1]) add(new SphereGeometry(.009, 8, 5), gold, [side * rx * .55, y, rz * .84]);
    }
    add(new BoxGeometry(.045,.035,.012), gold, [0,.20,.103]);
  }
  return { root, recipe: { tool: false }, triangles: () => {
    let count = 0; root.traverse(object => { if (object instanceof Mesh) count += (object.geometry.index?.count ?? object.geometry.getAttribute("position").count) / 3; });
    return count;
  }, dispose: () => { disposeMeshGeometries(root);
    owned.forEach(surface => surface.dispose()); root.removeFromParent(); } };
};
