import { ConeGeometry, CylinderGeometry, Group, IcosahedronGeometry, MeshStandardMaterial, SphereGeometry, Vector3 } from "three";

import { polygon, put, rockGeometry, slab } from "./ui-action-icon-kit";

type Climate = "desert" | "forest" | "swamp" | "tropical" | "winter";
const COLORS = {
  desert: { ground: "#d9ab61", shore: "#efcc86", soil: "#986e49", water: "#328b9c" },
  forest: { ground: "#608844", shore: "#c8b181", soil: "#75624c", water: "#438ca1" },
  swamp: { ground: "#68764a", shore: "#92946c", soil: "#555c43", water: "#3e716b" },
  tropical: { ground: "#70a54b", shore: "#f0dc9f", soil: "#99805e", water: "#37adaf" },
  winter: { ground: "#eef1e7", shore: "#c9dce1", soil: "#7b8990", water: "#6aaabd" }
};
const material = (color: string) => new MeshStandardMaterial({ color, roughness: .9, flatShading: true });
const COAST: readonly (readonly [number, number])[] = [
  [-.98, -.38], [-.64, -.70], [-.13, -.76], [.32, -.58], [.81, -.43], [.97, -.04],
  [.69, .30], [.77, .58], [.30, .75], [-.12, .59], [-.58, .68], [-.91, .29]
];
const landLayer = (root: Group, scale: number, y: number, depth: number, color: string) => {
  const coast = polygon(COAST.map(([x, z]) => [x * scale, z * scale] as const));
  return put(root, slab(coast, depth, .025), material(color), [0, y, 0], [-Math.PI / 2, 0, 0]);
};
const branch = (root: Group, from: Vector3, to: Vector3, width: number, color = "#6b5139") => {
  const direction = to.clone().sub(from);
  const mesh = put(root, new CylinderGeometry(width * .7, width, direction.length(), 7), material(color),
    from.clone().add(to).multiplyScalar(.5).toArray());
  mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize());
};
const pine = (root: Group, x: number, z: number, height: number, snowy: boolean) => {
  put(root, new CylinderGeometry(.026, .04, height * .6, 7), material("#695440"), [x, .12 + height * .3, z]);
  for (let tier = 0; tier < 3; tier++) {
    const radius = height * (.29 - tier * .055), y = .18 + height * (.3 + tier * .21);
    put(root, new ConeGeometry(radius, height * .55, 9), material("#315b43"), [x, y, z]);
    if (snowy) put(root, new ConeGeometry(radius * .94, height * .46, 9), material("#f1f5ef"), [x, y + .045, z]);
  }
};
const palm = (root: Group, x: number, z: number, height: number) => {
  const crown = new Vector3(x + .10, .12 + height, z);
  branch(root, new Vector3(x, .1, z), crown, .035, "#92704b");
  for (let leaf = 0; leaf < 6; leaf++) {
    const angle = leaf * Math.PI / 3;
    const mesh = put(root, new SphereGeometry(1, 8, 5), material(leaf % 2 ? "#4e893c" : "#397c39"),
      [crown.x + Math.cos(angle) * .16, crown.y, crown.z + Math.sin(angle) * .16]);
    mesh.scale.set(.30, .035, .085); mesh.rotation.y = -angle; mesh.rotation.z = -.20;
  }
};
const mangrove = (root: Group, x: number, z: number, height: number) => {
  const crotch = new Vector3(x, .30, z), crown = new Vector3(x + .04, height + .10, z);
  branch(root, crotch, crown, .045);
  for (let rootIndex = 0; rootIndex < 4; rootIndex++) {
    const angle = rootIndex * Math.PI / 2;
    branch(root, new Vector3(x + Math.cos(angle) * .18, .10, z + Math.sin(angle) * .18), crotch, .022);
  }
  for (const side of [-1, 1]) {
    const centre = crown.clone().add(new Vector3(side * .12, -.03, side * .04));
    branch(root, crotch, centre, .025);
    const leaves = put(root, new IcosahedronGeometry(1, 1), material(side < 0 ? "#486039" : "#667d44"), centre.toArray());
    leaves.scale.set(.28, .17, .25);
  }
};

/** Climate illustrations of natural islands, not fabricated previews of a discovered island's exact map. */
export const createClimateIslandIcon = (climate: Climate) => {
  const root = new Group(), colors = COLORS[climate];
  landLayer(root, 1.08, -.14, .06, colors.water);
  landLayer(root, .96, -.06, .20, colors.soil);
  landLayer(root, 1, .045, .07, colors.shore);
  landLayer(root, .86, .09, .06, colors.ground);
  if (climate === "desert") {
    for (const [x, z, angle] of [[-.35, .18, -.2], [.30, -.18, .35]]) {
      const dune = put(root, new SphereGeometry(1, 16, 9), material("#e6bd75"), [x!, .15, z!]);
      dune.scale.set(.37, .13, .24); dune.rotation.y = angle!;
    }
    const ridge = put(root, rockGeometry(9, 1), material("#a77e57"), [.28, .20, -.35]);
    ridge.scale.set(.24, .23, .18);
  } else if (climate === "tropical") {
    palm(root, -.33, .12, .63); palm(root, .32, -.22, .76); palm(root, .20, .35, .48);
  } else if (climate === "swamp") {
    for (const [x, z] of [[-.35, -.10], [.32, .24], [.02, -.4]]) {
      const pool = put(root, new CylinderGeometry(1, 1, .018, 16),
        new MeshStandardMaterial({ color: "#375c54", roughness: .3 }), [x!, .135, z!]);
      pool.scale.set(.30, 1, .18);
    }
    mangrove(root, -.3, .12, .47); mangrove(root, .30, -.14, .65); mangrove(root, .33, .36, .35);
  } else {
    const snowy = climate === "winter";
    pine(root, -.35, .12, .65, snowy); pine(root, .18, -.30, .80, snowy); pine(root, .37, .25, .52, snowy);
    const ridge = put(root, rockGeometry(4, 1), material(snowy ? "#dfe7e7" : "#879083"), [-.12, .20, -.36]);
    ridge.scale.set(.25, .28, .20);
  }
  return root;
};

export const UI_ISLAND_ICONS = {
  "island-desert": () => createClimateIslandIcon("desert"),
  "island-forest": () => createClimateIslandIcon("forest"),
  "island-swamp": () => createClimateIslandIcon("swamp"),
  "island-tropical": () => createClimateIslandIcon("tropical"),
  "island-winter": () => createClimateIslandIcon("winter")
};
