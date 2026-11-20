import type * as Three from "three";

import { canvasTexture, seededRandom, type ThreeModule } from "./emblem-helpers";

/**
 * Nubian spear for the victory emblem (see victory-emblems.ts): forged leaf-shaped iron head with
 * a midrib, conical socket, copper and leather spiral bindings, a hair tuft, a tapered grained
 * wooden shaft and an iron butt spike. Local origin at the grip, head pointing up +y.
 */
const SHAFT_TOP = 2.5, SHAFT_BOTTOM = -.3, SHAFT_LENGTH = SHAFT_TOP - SHAFT_BOTTOM;
const HEAD_BASE = 2.66, HEAD_LENGTH = .8, HEAD_WIDTH = .12, HEAD_RIB = .026;
type Material = Three.Material;

/** Soft studio surroundings (light sky, two softboxes, dark floor) for the metal reflections. */
const studioEnvironment = (T: ThreeModule) => {
  const texture = canvasTexture(T, 512, g => {
    const sky = g.createLinearGradient(0, 0, 0, 512);
    sky.addColorStop(0, "#cfccc6"); sky.addColorStop(.48, "#6f6c67"); sky.addColorStop(.55, "#3a3430");
    sky.addColorStop(1, "#15110e");
    g.fillStyle = sky; g.fillRect(0, 0, 512, 512);
    g.fillStyle = "#ffffff"; g.fillRect(60, 90, 90, 120); g.fillRect(330, 120, 70, 90);
  });
  texture.mapping = T.EquirectangularReflectionMapping;
  return texture;
};

const woodGrain = (T: ThreeModule) => {
  const texture = canvasTexture(T, 256, g => {
    g.fillStyle = "#4a2d18"; g.fillRect(0, 0, 256, 256);
    const random = seededRandom(23);
    for (let streak = 0; streak < 140; streak++) {
      g.fillStyle = random() > .5 ? "#2c190c" : "#6b4424";
      g.globalAlpha = .25 + random() * .4;
      g.fillRect(random() * 256, 0, 1 + random() * 3, 256);
    }
    g.globalAlpha = .5; g.fillStyle = "#24140a";
    for (let knot = 0; knot < 5; knot++) {
      g.beginPath(); g.ellipse(random() * 256, random() * 256, 3, 10, 0, 0, Math.PI * 2); g.fill();
    }
  });
  texture.wrapS = texture.wrapT = T.RepeatWrapping; texture.repeat.set(1, 6);
  return texture;
};

const spearMaterials = (T: ThreeModule) => {
  const environment = studioEnvironment(T);
  return {
    copper: new T.MeshStandardMaterial({ color: "#c8703c", envMap: environment, metalness: .9, roughness: .28 }),
    forged: new T.MeshStandardMaterial({ color: "#5d6166", envMap: environment, metalness: .85, roughness: .5 }),
    hairDark: new T.MeshStandardMaterial({ color: "#1d1611", roughness: .8 }),
    hairLight: new T.MeshStandardMaterial({ color: "#e9dfc8", roughness: .8 }),
    iron: new T.MeshStandardMaterial({ envMap: environment, envMapIntensity: .9, metalness: .92, roughness: .3,
      vertexColors: true }),
    leather: new T.MeshStandardMaterial({ color: "#6a3a1c", roughness: .7 }),
    wood: new T.MeshStandardMaterial({ map: woodGrain(T), roughness: .62 })
  };
};
type SpearMaterials = ReturnType<typeof spearMaterials>;

/** Leaf profile: narrow at the socket, widest at a quarter, long tapering point. */
const headHalfWidth = (along: number) => HEAD_WIDTH * Math.sin(Math.PI * Math.pow(along, .5)) * (1 - along * .15);

/** Diamond cross-section at `along`: left edge, front midrib, right edge, back midrib. */
const headRing = (T: ThreeModule, along: number) => {
  const width = headHalfWidth(along), rib = HEAD_RIB * (1 - along * .8) + .002, y = along * HEAD_LENGTH;
  return [new T.Vector3(-width, y, 0), new T.Vector3(0, y, rib), new T.Vector3(width, y, 0),
    new T.Vector3(0, y, -rib)];
};

/** Darker hammered iron towards the socket, bright polished towards the point. */
const forgedShade = (T: ThreeModule, along: number) =>
  new T.Color("#b9c0c6").multiplyScalar(.5 + .5 * Math.min(1, along * 2.2));

/**
 * One of the four bevel faces between two cross-section corners: smooth along the length,
 * crisp at the midrib and the edges because each face keeps its own normals.
 */
const headFace = (T: ThreeModule, face: number, material: Material) => {
  const rows = 40, positions: number[] = [], colors: number[] = [], indices: number[] = [];
  for (let row = 0; row <= rows; row++) {
    const along = row / rows, ring = headRing(T, along), shade = forgedShade(T, along);
    for (const corner of [ring[face]!, ring[(face + 1) % 4]!]) {
      positions.push(corner.x, corner.y, corner.z); colors.push(shade.r, shade.g, shade.b);
    }
  }
  for (let row = 0; row < rows; row++) {
    const low = row * 2, high = low + 2;
    indices.push(low, low + 1, high, low + 1, high + 1, high);
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return new T.Mesh(geometry, material);
};
const spearhead = (T: ThreeModule, materials: SpearMaterials) => {
  const head = new T.Group();
  for (let face = 0; face < 4; face++) head.add(headFace(T, face, materials.iron));
  head.position.y = HEAD_BASE;
  const socket = new T.Mesh(new T.CylinderGeometry(.018, .042, .26, 18), materials.forged);
  socket.position.y = HEAD_BASE - .12;
  const ring = new T.Mesh(new T.TorusGeometry(.043, .008, 8, 20), materials.forged); ring.rotation.x = Math.PI / 2;
  ring.position.y = HEAD_BASE - .25;
  const group = new T.Group(); group.add(head, socket, ring);
  return group;
};

/** A raised wire or thong wound in a helix around the shaft. */
const spiralBinding = (
  T: ThreeModule, from: number, length: number, radius: number, turns: number, thickness: number, material: Material
) => {
  const points = Array.from({ length: turns * 16 + 1 }, (_, step) => {
    const angle = step / 16 * Math.PI * 2;
    return new T.Vector3(Math.cos(angle) * radius, from + step / (turns * 16) * length, Math.sin(angle) * radius);
  });
  return new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(points), turns * 24, thickness, 6), material);
};

/** Hair tuft below the head: dark and pale strands splaying downwards from the socket. */
const hairTuft = (T: ThreeModule, materials: SpearMaterials) => {
  const tuft = new T.Group();
  const strand = new T.CylinderGeometry(.009, .003, .26, 4); strand.translate(0, -.13, 0);
  for (let index = 0; index < 32; index++) {
    const holder = new T.Group();
    holder.rotation.set(Math.sin(index * 2.4) * .3, index / 32 * Math.PI * 2, .12 + (index % 4) * .06);
    holder.add(new T.Mesh(strand, index % 3 ? materials.hairDark : materials.hairLight));
    tuft.add(holder);
  }
  tuft.position.y = HEAD_BASE - .26;
  return tuft;
};

export const createNubianSpear = (T: ThreeModule) => {
  const materials = spearMaterials(T);
  const weapon = new T.Group();
  const shaft = new T.Mesh(new T.CylinderGeometry(.026, .036, SHAFT_LENGTH, 18), materials.wood);
  shaft.position.y = (SHAFT_TOP + SHAFT_BOTTOM) / 2; weapon.add(shaft);
  weapon.add(spearhead(T, materials), hairTuft(T, materials));
  weapon.add(spiralBinding(T, HEAD_BASE - .42, .14, .03, 7, .006, materials.copper));
  weapon.add(spiralBinding(T, -.2, .34, .037, 9, .009, materials.leather));
  const ferrule = new T.Mesh(new T.CylinderGeometry(.037, .03, .1, 16), materials.forged);
  ferrule.position.y = SHAFT_BOTTOM - .02; weapon.add(ferrule);
  const spike = new T.Mesh(new T.ConeGeometry(.03, .16, 16), materials.forged); spike.rotation.x = Math.PI;
  spike.position.y = SHAFT_BOTTOM - .15; weapon.add(spike);
  weapon.scale.set(1.3, .95, 1.3);
  return weapon;
};
