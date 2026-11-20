import { CapsuleGeometry, CatmullRomCurve3, Group, Mesh, MeshStandardMaterial, SphereGeometry, TubeGeometry, Vector3 } from "three";

/** Two clasped hands with interlocked fingers and distinct linen cuffs, for the recruit action. */
export const createHandshakeIcon = () => {
  const root = new Group();
  const hand = (side: number, skin: string, sleeve: string) => {
    const material = new MeshStandardMaterial({ color: skin, roughness: .68 });
    const cloth = new MeshStandardMaterial({ color: sleeve, roughness: .9 });
    const segment = (from: number[], to: number[], radius: number, paint = material) => {
      const start = new Vector3(...from as [number, number, number]);
      const end = new Vector3(...to as [number, number, number]);
      const direction = end.clone().sub(start);
      const mesh = new Mesh(new CapsuleGeometry(radius, direction.length(), 5, 10), paint);
      mesh.position.copy(start.add(end).multiplyScalar(.5));
      mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize());
      root.add(mesh);
    };
    segment([side * 1.05, .38, -.02], [side * .66, .17, 0], .22, cloth);
    segment([side * .67, .17, 0], [side * .33, -.02, .02], .16);
    const palm = new Mesh(new SphereGeometry(1, 16, 10), material);
    palm.scale.set(.34, .19, .15);
    palm.position.set(side * .16, -.09, side > 0 ? -.025 : .025);
    palm.rotation.z = side * -.24;
    root.add(palm);
    for (let finger = 0; finger < 4; finger++) {
      const y = -.025 - finger * .085;
      const z = side < 0 ? .17 : -.17;
      const curve = new CatmullRomCurve3([
        new Vector3(side * .27, y, z * .35), new Vector3(-side * .08, y - .07, z),
        new Vector3(-side * .27, y - .015, z * .8), new Vector3(-side * .25, y + .08, z * .3)
      ]);
      root.add(new Mesh(new TubeGeometry(curve, 12, .047 - finger * .003, 7, false), material));
    }
    const thumb = new CatmullRomCurve3([
      new Vector3(side * .35, .07, .09), new Vector3(side * .09, .13, .20),
      new Vector3(-side * .10, .04, .19), new Vector3(-side * .08, -.02, .14)
    ]);
    root.add(new Mesh(new TubeGeometry(thumb, 14, .075, 9, false), material));
  };
  hand(-1, "#d5a16f", "#2965a0");
  hand(1, "#ad754e", "#eee2c6");
  return root;
};
