import type * as Three from "three";

import type { ThreeModule } from "./emblem-helpers";

/**
 * 3D cherry blossom branch for the Japanese victory emblem (see victory-emblems.ts): cupped,
 * notched petals with a magenta flush at the base, long filaments with gold anthers, double
 * (yaezakura) pompoms, deep pink buds on stalks and young bronze-green leaves on a dark twig.
 */
interface PetalForm {
  cup: number;
  length: number;
  lift: number;
  notch: number;
  ruffle: number;
  width: number;
}
interface PetalColours { base: Three.Color; middle: Three.Color; tip: Three.Color }

const smoothstep = (from: number, to: number, value: number) => {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

/** Obovate outline: narrow claw at the base, widest about two thirds out, broad rounded tip. */
const petalHalfWidth = (along: number) => .25 + .75 * Math.sin(Math.PI * .85 * Math.pow(along, .75));

const petalColour = (colours: PetalColours, along: number) =>
  colours.base.clone().lerp(colours.middle, smoothstep(0, .45, along))
    .lerp(colours.tip, smoothstep(.6, 1, along) * .6);

/** One curved petal surface: cupped across, lifted towards the tip, notched at the tip centre. */
const petalGeometry = (T: ThreeModule, form: PetalForm, colours: PetalColours) => {
  const across = 8, along = 10, positions: number[] = [], colors: number[] = [], indices: number[] = [];
  for (let row = 0; row <= along; row++) for (let column = 0; column <= across; column++) {
    const v = row / along, u = column / across * 2 - 1;
    const notch = 1 - form.notch * Math.exp(-((u * 4) ** 2)) * v ** 6;
    const z = form.cup * u * u * v * form.length + form.lift * v * v * form.length +
      form.ruffle * Math.sin(u * 5 + v * 3) * v * form.length;
    positions.push(u * petalHalfWidth(v) * form.width, form.length * v * notch, z);
    const colour = petalColour(colours, v);
    colors.push(colour.r, colour.g, colour.b);
  }
  for (let row = 0; row < along; row++) for (let column = 0; column < across; column++) {
    const corner = row * (across + 1) + column, next = corner + across + 1;
    indices.push(corner, corner + 1, next, corner + 1, next + 1, next);
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
};

const sakuraMaterials = (T: ThreeModule) => ({
  anther: new T.MeshStandardMaterial({ color: "#e0a82a", emissive: "#3a2400", emissiveIntensity: .3,
    roughness: .5 }),
  bark: new T.MeshStandardMaterial({ color: "#3a2c28", roughness: .85 }),
  bud: new T.MeshStandardMaterial({ color: "#d8346a", emissive: "#3a0614", emissiveIntensity: .2,
    roughness: .45 }),
  filament: new T.MeshStandardMaterial({ color: "#fbe3ea", roughness: .5 }),
  heart: new T.MeshStandardMaterial({ color: "#c2275c", roughness: .5 }),
  leaf: new T.MeshStandardMaterial({ roughness: .55, side: T.DoubleSide, vertexColors: true }),
  petal: new T.MeshStandardMaterial({ emissive: "#5a1a2c", emissiveIntensity: .25, roughness: .55,
    side: T.DoubleSide, vertexColors: true }),
  stalk: new T.MeshStandardMaterial({ color: "#6f6a2c", roughness: .7 })
});
type SakuraMaterials = ReturnType<typeof sakuraMaterials>;

const PETAL_COLOURS = (T: ThreeModule): PetalColours => ({
  base: new T.Color("#d9467a"), middle: new T.Color("#f7aec6"), tip: new T.Color("#fde4ec")
});

/** Ring of thin white-pink filaments rising from the centre, each tipped with a gold anther. */
const stamens = (T: ThreeModule, size: number, materials: SakuraMaterials) => {
  const group = new T.Group();
  const filament = new T.CylinderGeometry(size * .012, size * .016, size * .55, 4);
  filament.translate(0, size * .275, 0);
  const anther = new T.SphereGeometry(size * .045, 8, 6);
  for (let index = 0; index < 22; index++) {
    const angle = index / 22 * Math.PI * 2, spread = .62 + (index % 3) * .14;
    const holder = new T.Group();
    holder.rotation.set(0, 0, angle);
    const stem = new T.Group(); stem.rotation.x = spread; holder.add(stem);
    stem.add(new T.Mesh(filament, materials.filament));
    const tip = new T.Mesh(anther, materials.anther); tip.position.y = size * .56; stem.add(tip);
    group.add(holder);
  }
  return group;
};

/** Single five-petal bloom facing +z, `size` = petal length. */
const singleBloom = (T: ThreeModule, size: number, materials: SakuraMaterials, twist: number) => {
  const flower = new T.Group();
  const geometry = petalGeometry(T, { cup: .32, length: size, lift: .28, notch: .14, ruffle: .015,
    width: size * .5 }, PETAL_COLOURS(T));
  for (let index = 0; index < 5; index++) {
    const petal = new T.Mesh(geometry, materials.petal);
    petal.rotation.z = twist + index / 5 * Math.PI * 2; flower.add(petal);
  }
  const heart = new T.Mesh(new T.SphereGeometry(size * .14, 12, 8), materials.heart); heart.scale.z = .5;
  heart.position.z = size * .03; flower.add(heart);
  flower.add(stamens(T, size, materials));
  return flower;
};

/** Double (yaezakura) pompom: three ruffled, increasingly cupped layers of petals. */
const doubleBloom = (T: ThreeModule, size: number, materials: SakuraMaterials, twist: number) => {
  const flower = new T.Group();
  const layers = [[9, 1, .3, 0], [8, .8, .5, .03], [6, .58, .8, .06]] as const;
  for (const [count, scale, cup, height] of layers) {
    const geometry = petalGeometry(T, { cup, length: size * scale, lift: .45 + cup * .3, notch: .12, ruffle: .05,
      width: size * scale * .55 }, PETAL_COLOURS(T));
    for (let index = 0; index < count; index++) {
      const petal = new T.Mesh(geometry, materials.petal);
      petal.rotation.z = twist + (index + scale) / count * Math.PI * 2; petal.position.z = size * height;
      flower.add(petal);
    }
  }
  return flower;
};

/** Deep pink closed bud on a short green stalk from `from` towards `direction`. */
const bud = (T: ThreeModule, from: Three.Vector3, direction: Three.Vector3, materials: SakuraMaterials) => {
  const group = new T.Group();
  const tip = from.clone().add(direction.clone().multiplyScalar(.09));
  group.add(new T.Mesh(new T.TubeGeometry(new T.LineCurve3(from, tip), 2, .005, 5), materials.stalk));
  const head = new T.Mesh(new T.SphereGeometry(.026, 14, 10), materials.bud); head.scale.set(1, 1.35, 1);
  head.position.copy(tip).add(direction.clone().multiplyScalar(.025));
  head.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), direction.clone().normalize());
  group.add(head);
  return group;
};

const LEAF_COLOURS = (T: ThreeModule): PetalColours => ({
  base: new T.Color("#7a5a24"), middle: new T.Color("#7f8a35"), tip: new T.Color("#9a6a2c")
});

const youngLeaf = (T: ThreeModule, materials: SakuraMaterials, angle: number) => {
  const leaf = new T.Mesh(petalGeometry(T, { cup: .25, length: .13, lift: .12, notch: 0, ruffle: 0, width: .045 },
    LEAF_COLOURS(T)), materials.leaf);
  leaf.rotation.z = angle;
  return leaf;
};

/** A cluster: one or two blooms, a bud on a stalk and sometimes a young leaf. */
const blossomCluster = (T: ThreeModule, at: Three.Vector3, index: number, side: number, materials: SakuraMaterials) => {
  const cluster = new T.Group();
  const isDouble = index % 4 === 3;
  const build = isDouble ? doubleBloom : singleBloom;
  const main = build(T, .115, materials, index * .9);
  main.position.set(at.x, at.y, at.z + .05); main.rotation.set(Math.sin(index) * .35, Math.cos(index) * .35, 0);
  cluster.add(main);
  if (index % 2 === 0) {
    const second = singleBloom(T, .095, materials, index * 1.7);
    second.position.set(at.x + side * .085, at.y - .05, at.z + .03); second.rotation.set(-.3, side * .4, 0);
    cluster.add(second);
  }
  cluster.add(bud(T, at, new T.Vector3(-side * .5, index % 2 ? .8 : -.6, .3), materials));
  if (index % 3 === 1) {
    const leaf = youngLeaf(T, materials, side * -.9 + Math.PI); leaf.position.copy(at); cluster.add(leaf);
  }
  return cluster;
};

/** A dark cherry twig curving up beside the shield, with side shoots carrying blossom clusters. */
export const createSakuraBranch = (T: ThreeModule, side: number) => {
  const materials = sakuraMaterials(T);
  const branch = new T.Group();
  const point = (x: number, y: number) => new T.Vector3(side * x, y, .1);
  const main = new T.CatmullRomCurve3([point(.3, -.92), point(.74, -.55), point(.88, .05), point(.74, .58),
    point(.44, .88)]);
  const shoots = [
    new T.CatmullRomCurve3([main.getPoint(.32), point(.98, -.32), point(1.08, -.2)]),
    new T.CatmullRomCurve3([main.getPoint(.66), point(.98, .5), point(1.04, .68)])
  ];
  branch.add(new T.Mesh(new T.TubeGeometry(main, 64, .026, 8), materials.bark));
  for (const shoot of shoots) branch.add(new T.Mesh(new T.TubeGeometry(shoot, 16, .014, 6), materials.bark));
  const spots = [
    ...[.1, .24, .45, .58, .8, .97].map(at => main.getPoint(at)),
    ...shoots.map(shoot => shoot.getPoint(1))
  ];
  spots.forEach((at, index) => branch.add(blossomCluster(T, at, index, side, materials)));
  return branch;
};
