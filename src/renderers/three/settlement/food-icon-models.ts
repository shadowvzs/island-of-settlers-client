import {
  CanvasTexture, CatmullRomCurve3, CylinderGeometry, Group, LatheGeometry, Mesh, MeshStandardMaterial,
  SphereGeometry, SRGBColorSpace, TorusGeometry, TubeGeometry, Vector2, Vector3
} from "three";

import { staticWareIcon } from "./static-ware-icon";

const surface = (color: string) => new MeshStandardMaterial({ color, roughness: .85 });

/** Five ripe wheat ears with paired plump kernels, fine awns, bowed stems and a rope binding. */
export const createWheatIconModel = () => {
  const root = new Group(), straw = surface("#ae772b"), grain = surface("#cb942f"), pale = surface("#e2b550");
  const stem = (points: Vector3[], radius: number, material: MeshStandardMaterial) => {
    root.add(new Mesh(new TubeGeometry(new CatmullRomCurve3(points), 12, radius, 5, false), material));
  };
  for (let ear = 0; ear < 5; ear++) {
    const x = (ear - 2) * .115, top = .99 - Math.abs(ear - 2) * .07, z = (ear % 2) * .07;
    stem([new Vector3((ear - 2) * .027,.04,0), new Vector3(x * .45,.42,z * .5),
      new Vector3(x,top,z)], .008, straw);
    for (let row = 0; row < 8; row++) for (const side of [-1, 1]) {
      const y = top - .31 + row * .038;
      const taper = 1 - row / 15;
      const kernel = new Mesh(new SphereGeometry(1, 16, 10), row % 3 ? grain : pale);
      kernel.scale.set(.026 * taper, .046 * taper, .023 * taper);
      kernel.position.set(x + side * .024 * taper, y, z + .012);
      kernel.rotation.z = -side * .48; root.add(kernel);
      stem([new Vector3(x + side * .034, y + .02, z),
        new Vector3(x + side * .06, y + .09, z),
        new Vector3(x + side * .08, y + .14, z)], .0018, pale);
    }
  }
  for (const y of [.24, .26, .28]) {
    const rope = new Mesh(new TorusGeometry(.066, .009, 8, 40), straw);
    rope.rotation.x = Math.PI / 2; rope.scale.z = .65; rope.position.y = y; root.add(rope);
  }
  return staticWareIcon(root);
};

/** An open folded linen sack, with cloth creases and an opaque mound of milled white flour. */
export const createFlourIconModel = () => {
  const root = new Group(), cloth = surface("#cbb17b"), rim = surface("#e2c797"), flour = surface("#fffefa");
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 256;
  const paint = canvas.getContext("2d")!;
  const shading = paint.createLinearGradient(0, 0, 256, 0);
  shading.addColorStop(0, "#b4935e"); shading.addColorStop(.45, "#ead2a0");
  shading.addColorStop(1, "#b4935e");
  paint.fillStyle = shading; paint.fillRect(0, 0, 256, 256);
  for (let thread = 0; thread < 256; thread += 3) {
    paint.strokeStyle = thread % 2 ? "#6a482950" : "#fff1cd85";
    paint.lineWidth = 1;
    paint.beginPath(); paint.moveTo(thread, 0); paint.lineTo(thread, 256); paint.stroke();
    paint.beginPath(); paint.moveTo(0, thread); paint.lineTo(256, thread); paint.stroke();
    for (let cross = 0; cross < 256; cross += 6) {
      paint.fillStyle = "#65452335";
      paint.fillRect(thread + (cross % 12 ? 1 : 0), cross, 1, 2);
    }
  }
  for (const seam of [8, 248]) {
    paint.strokeStyle = "#74512c"; paint.lineWidth = 2;
    paint.beginPath(); paint.moveTo(seam, 0); paint.lineTo(seam, 256); paint.stroke();
    paint.strokeStyle = "#f5e4bd"; paint.setLineDash([3, 3]);
    paint.beginPath(); paint.moveTo(seam + 3, 0); paint.lineTo(seam + 3, 256); paint.stroke();
    paint.setLineDash([]);
  }
  const linen = new CanvasTexture(canvas); linen.colorSpace = SRGBColorSpace; cloth.map = linen; rim.map = linen;
  cloth.bumpMap = linen; cloth.bumpScale = .008;
  rim.bumpMap = linen; rim.bumpScale = .008;
  const points = [[.21,.025],[.28,.07],[.31,.24],[.30,.43],[.265,.59],[.28,.66],[.25,.68],[.235,.62],[.24,.20]];
  const body = new LatheGeometry(points.map(([x,y]) => new Vector2(x!, y!)), 64);
  const vertices = body.getAttribute("position");
  for (let i = 0; i < vertices.count; i++) {
    const x = vertices.getX(i), y = vertices.getY(i), z = vertices.getZ(i), angle = Math.atan2(z, x);
    const fold = 1 + .055 * Math.sin(angle * 9 + y * 12) + .03 * Math.sin(angle * 5 - y * 9);
    vertices.setXYZ(i, x * fold, y, z * fold);
  }
  body.computeVertexNormals(); root.add(new Mesh(body, cloth));
  const lip = new Mesh(new TorusGeometry(.264, .028, 12, 64), rim);
  lip.rotation.x = Math.PI / 2; lip.position.y = .655; root.add(lip);
  const heap = [[0,.83],[.06,.81],[.13,.765],[.20,.715],[.245,.665]];
  root.add(new Mesh(new LatheGeometry(heap.reverse().map(([x,y]) => new Vector2(x!, y!)), 64), flour));
  for (let i = 0; i < 14; i++) {
    const angle = i * 2.4, radius = .035 + (i % 4) * .045;
    const clump = new Mesh(new SphereGeometry(.011 + i % 3 * .003, 10, 6), flour);
    clump.position.set(Math.cos(angle) * radius, .82 - radius * .63, Math.sin(angle) * radius); root.add(clump);
  }
  const base = new Mesh(new CylinderGeometry(.23, .23, .035, 48), cloth); base.position.y = .027; root.add(base);
  return staticWareIcon(root);
};
