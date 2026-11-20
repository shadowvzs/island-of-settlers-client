import { BoxGeometry, ExtrudeGeometry, Group, Mesh, MeshStandardMaterial, Path, Shape, ShapeGeometry, SphereGeometry } from "three";

/** White bone, bevelled orbital openings and separate teeth remain legible at difficulty-badge size. */
export const createSkullIcon = () => {
  const root = new Group();
  const bone = new MeshStandardMaterial({ color: "#fffaf0", roughness: .62 });
  const cavity = new MeshStandardMaterial({ color: "#292520", roughness: 1 });
  const put = (geometry: BoxGeometry | ExtrudeGeometry | ShapeGeometry | SphereGeometry,
    material: MeshStandardMaterial, x: number, y: number, z: number) => {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, y, z);
    root.add(mesh);
    return mesh;
  };
  const cranium = put(new SphereGeometry(1, 28, 20), bone, 0, .22, -.05);
  cranium.scale.set(.58, .59, .36);
  const face = new Shape();
  face.moveTo(-.32, -.36);
  face.lineTo(-.49, -.12);
  face.bezierCurveTo(-.64, .18, -.59, .68, 0, .72);
  face.bezierCurveTo(.59, .68, .64, .18, .49, -.12);
  face.lineTo(.32, -.36);
  face.closePath();
  for (const side of [-1, 1]) {
    const eye = new Path();
    eye.absellipse(side * .225, .12, .155, .17, side * -.14, Math.PI * 2 + side * -.14, true);
    face.holes.push(eye);
  }
  const nose = new Path();
  nose.moveTo(0, -.085);
  nose.lineTo(-.075, -.265);
  nose.quadraticCurveTo(0, -.22, .075, -.265);
  nose.closePath();
  face.holes.push(nose);
  put(new ExtrudeGeometry(face, { bevelEnabled: true, bevelSegments: 3,
    bevelSize: .028, bevelThickness: .027, curveSegments: 24, depth: .18, steps: 1 }), bone, 0, 0, .20);
  const shadow = face.clone();
  shadow.holes = [];
  put(new ShapeGeometry(shadow), cavity, 0, 0, .345);
  for (const side of [-1, 1]) {
    const cheek = put(new SphereGeometry(1, 14, 10), bone, side * .405, -.16, .30);
    cheek.scale.set(.14, .115, .12);
  }
  const jaw = put(new SphereGeometry(1, 20, 12), bone, 0, -.505, .23);
  jaw.scale.set(.36, .13, .17);
  for (let tooth = 0; tooth < 6; tooth++)
    put(new BoxGeometry(.091, .135, .125), bone, (tooth - 2.5) * .103, -.37, .365);
  root.rotation.y = -.08;
  return root;
};
