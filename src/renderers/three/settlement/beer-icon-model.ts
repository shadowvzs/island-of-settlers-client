import {
  BufferGeometry, CanvasTexture, CatmullRomCurve3, CylinderGeometry, Group, LatheGeometry, Mesh,
  MeshStandardMaterial, RepeatWrapping, SphereGeometry, SRGBColorSpace, TorusGeometry, TubeGeometry, Vector2, Vector3
} from "three";

import { staticWareIcon } from "./static-ware-icon";

/** Original carved wooden tankard: oak staves, dark decorated hoops and a creamy overflowing head. */
export const createBeerIconModel = () => {
  const root = new Group();
  const canvas = document.createElement("canvas"); canvas.width = 256; canvas.height = 512;
  const paint = canvas.getContext("2d")!;
  paint.fillStyle = "#bc813d"; paint.fillRect(0, 0, 256, 512);
  for (let line = 0; line < 14; line++) {
    const x = line * 19.7;
    paint.strokeStyle = line % 3 ? "#72431c88" : "#e9af5aaa";
    paint.lineWidth = line % 4 ? 2.2 : 3.5;
    paint.beginPath();
    for (let y = 0; y <= 512; y += 4) {
      const bend = Math.sin(y * .018 + line * 2.7) * 8 + Math.sin(y * .043 + line) * 3;
      if (!y) paint.moveTo(x + bend, y); else paint.lineTo(x + bend, y);
    }
    paint.stroke();
  }
  paint.strokeStyle = "#68401c"; paint.lineWidth = 3;
  for (const [x, y] of [[70, 170], [188, 370]]) {
    paint.beginPath(); paint.ellipse(x!, y!, 14, 43, .07, 0, Math.PI * 2); paint.stroke();
    paint.beginPath(); paint.ellipse(x!, y!, 5, 24, .07, 0, Math.PI * 2); paint.stroke();
  }
  const grain = new CanvasTexture(canvas); grain.wrapS = grain.wrapT = RepeatWrapping;
  grain.colorSpace = SRGBColorSpace;
  const wood = new MeshStandardMaterial({ color: "#ffffff", map: grain, roughness: .72 });
  const darkWood = new MeshStandardMaterial({ color: "#d5b389", map: grain, roughness: .8 });
  const metal = new MeshStandardMaterial({ color: "#544e32", metalness: .72, roughness: .4 });
  const engraved = new MeshStandardMaterial({ color: "#a69862", metalness: .6, roughness: .45 });
  const foam = new MeshStandardMaterial({ color: "#fff1c9", roughness: .94 });
  const add = (geometry: BufferGeometry, material: MeshStandardMaterial, x = 0, y = 0, z = 0) => {
    const mesh = new Mesh(geometry, material); mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true; root.add(mesh); return mesh;
  };
  const profile = [[.25,.035],[.3,.07],[.315,.18],[.30,.65],[.29,.76],[.245,.76],[.245,.17]];
  for (let stave = 0; stave < 12; stave++)
    add(new LatheGeometry(profile.map(([x,y]) => new Vector2(x!, y!)), 4,
      stave * Math.PI / 6 + .004, Math.PI / 6 - .008), stave % 4 ? wood : darkWood);
  add(new CylinderGeometry(.25, .25, .065, 48), wood, 0, .045);
  for (const y of [.17, .64]) {
    add(new CylinderGeometry(.319, .319, .09, 64, 1, true), metal, 0, y);
    for (const rimY of [y - .047, y + .047]) {
      const rim = add(new TorusGeometry(.32, .009, 6, 64), engraved, 0, rimY); rim.rotation.x = Math.PI / 2;
    }
    for (let i = 0; i < 20; i++) {
      const angle = i * Math.PI / 10;
      const leaf = add(new SphereGeometry(.018, 8, 6), engraved,
        Math.sin(angle) * .322, y, Math.cos(angle) * .322);
      leaf.scale.set(.6, 1.4, .5); leaf.rotation.z = i % 2 ? .65 : -.65;
    }
  }
  const handle = new CatmullRomCurve3([new Vector3(.27,.65,0), new Vector3(.52,.68,0),
    new Vector3(.65,.52,0), new Vector3(.65,.30,0), new Vector3(.51,.16,0), new Vector3(.29,.19,0)]);
  add(new TubeGeometry(handle, 40, .065, 10, false), wood);
  add(new CylinderGeometry(.247, .247, .015, 48),
    new MeshStandardMaterial({ color: "#d88c16", roughness: .25 }), 0, .735);
  const head = add(new SphereGeometry(.25, 32, 16), foam, 0, .775); head.scale.y = .32;
  for (let i = 0; i < 14; i++) {
    const angle = i * 2.4, radius = .19 * Math.sqrt((i + 1) / 14);
    const bubble = add(new SphereGeometry(.065 + (i % 3) * .012, 16, 10), foam,
      Math.cos(angle) * radius, .79 + (i % 4) * .015, Math.sin(angle) * radius);
    bubble.scale.y = .75;
  }
  for (const [x, y, z, length] of [[.11,.70,.279,.19],[-.18,.735,.23,.10]]) {
    const drip = add(new SphereGeometry(.035, 16, 12), foam, x, y, z); drip.scale.y = length! / .07;
  }
  return staticWareIcon(root);
};
