import {
  Group,
  Mesh,
  MeshBasicMaterial,
  PointLight,
  SphereGeometry,
  VectorKeyframeTrack
} from "three";

const lampScale = (time: number) => 0.9 + Math.sin(time * Math.PI * 7) * 0.07
  + Math.sin(time * Math.PI * 11) * 0.035;

/** Warm guarded adit lamp. Minimal retains the same working signal without dynamic lighting. */
export const createRomanMineLight = (id: number, detailed: boolean) => {
  if (![10, 11, 12, 13].includes(id)) return undefined;
  const root = new Group();
  root.name = "mine_working_light";
  const lamp = new Group();
  lamp.name = "mine_lamp_flame";
  lamp.position.set(0.205, 0.61, 0.446);
  const material = new MeshBasicMaterial({ color: 0xffb45b, toneMapped: false });
  const flame = new Mesh(new SphereGeometry(1, detailed ? 8 : 4, detailed ? 6 : 3), material);
  flame.scale.set(0.023, 0.041, 0.009);
  flame.userData.ownedMaterial = true;
  lamp.add(flame);
  root.add(lamp);
  const light = detailed ? new PointLight(0xffb45b, 0.3, 1.5, 2) : undefined;
  if (light) {
    light.name = "mine_interior_light";
    light.position.set(-0.17, 0.56, 0.12);
    root.add(light);
  }
  const times = Array.from({ length: 41 }, (_, index) => index / 20);
  const tracks = [new VectorKeyframeTrack(
    `${lamp.name}.scale`,
    times,
    times.flatMap((time) => {
      const scale = lampScale(time);
      return [scale, scale, scale];
    })
  )];
  const update = (time: number, working: boolean) => {
    root.visible = working;
    const scale = lampScale(time);
    lamp.scale.setScalar(scale);
    if (light) light.intensity = working ? 0.3 * scale : 0;
  };
  return { root, tracks, update };
};
