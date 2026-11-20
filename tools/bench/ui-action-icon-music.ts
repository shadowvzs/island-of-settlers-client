import { CapsuleGeometry, ExtrudeGeometry, Group, MeshStandardMaterial, Shape, SphereGeometry } from "three";

import { put, surfaces } from "./ui-action-icon-kit";

/** An original pair of polished jade notes with rounded brass stems and a bevelled beam. */
export const createMusicPlayerIcon = () => {
  const root = new Group();
  const enamel = new MeshStandardMaterial({ color: 0x38b7a6, metalness: .3, roughness: .24 });
  for (const [x, y, length] of [[-.22, -.38, .92], [.43, -.23, .91]] as const) {
    put(root, new CapsuleGeometry(.047, length, 8, 16), surfaces.gold, [x, y + length / 2, 0]);
    const head = put(root, new SphereGeometry(1, 32, 20), enamel, [x - .12, y, .015]);
    head.scale.set(.24, .155, .135);
    head.rotation.z = .32;
  }
  const beam = new Shape();
  beam.moveTo(-.265, .48);
  beam.lineTo(.475, .64);
  beam.lineTo(.475, .82);
  beam.lineTo(-.265, .66);
  beam.closePath();
  put(root, new ExtrudeGeometry(beam, {
    bevelEnabled: true, bevelSegments: 5, bevelSize: .035, bevelThickness: .035,
    curveSegments: 16, depth: .07, steps: 1
  }), surfaces.gold, [0, 0, -.035]);
  root.rotation.z = -.1;
  return root;
};
