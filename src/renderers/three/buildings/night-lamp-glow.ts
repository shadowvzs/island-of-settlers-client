import { DataTexture, Mesh, MeshStandardMaterial, type Object3D, RGBAFormat, SRGBColorSpace } from "three";

/**
 * The warm glass map of a lamp at night. Painted once, deterministic, no DOM or worker work at
 * runtime: the bright middle and mottled edges keep a small pane from reading as a flat amber box.
 */
const GLOW_TEXTURE_SIZE = 64;

const createGlowPixels = () => {
  const pixels = new Uint8Array(GLOW_TEXTURE_SIZE * GLOW_TEXTURE_SIZE * 4);
  for (let y = 0; y < GLOW_TEXTURE_SIZE; y++) for (let x = 0; x < GLOW_TEXTURE_SIZE; x++) {
    const u = (x + .5) / GLOW_TEXTURE_SIZE, v = (y + .5) / GLOW_TEXTURE_SIZE;
    const centre = Math.max(0, 1 - Math.hypot(u - .5, v - .5) * 1.5);
    const mottle = Math.sin(u * Math.PI * 9 + Math.sin(v * Math.PI * 5) * .8)
      * Math.sin(v * Math.PI * 11 + u * 2.4) * .045;
    const bubbles = Math.max(0, Math.sin(u * Math.PI * 27) * Math.sin(v * Math.PI * 23)) ** 12 * .06;
    const shade = .58 + centre * .42 + mottle - bubbles;
    const offset = (y * GLOW_TEXTURE_SIZE + x) * 4;
    pixels[offset] = Math.round(255 * shade);
    pixels[offset + 1] = Math.round(255 * shade * .74);
    pixels[offset + 2] = Math.round(255 * shade * .44);
    pixels[offset + 3] = 255;
  }
  return pixels;
};

let glowTexture: DataTexture | undefined;
const nightLampTexture = () => {
  if (glowTexture) return glowTexture;
  glowTexture = new DataTexture(createGlowPixels(), GLOW_TEXTURE_SIZE, GLOW_TEXTURE_SIZE, RGBAFormat);
  glowTexture.colorSpace = SRGBColorSpace;
  glowTexture.needsUpdate = true;
  return glowTexture;
};

const glowMaterials = new WeakMap<MeshStandardMaterial, MeshStandardMaterial>();

/**
 * One warm emissive twin per source material: the same texture and surface detail, a dark body and
 * a bright amber glow. It is a cheap emissive, never a real light, and is released with its source.
 */
const nightLampGlowMaterial = (source: MeshStandardMaterial) => {
  const cached = glowMaterials.get(source);
  if (cached) return cached;
  const glow = source.clone();
  glow.color.setHex(0x2b1809);
  glow.emissive.setHex(0xffb45e);
  glow.emissiveMap = nightLampTexture();
  glow.emissiveIntensity = 2.4;
  glow.metalness = 0;
  glow.roughness = .9;
  glow.name = "building-night-lamp-warm-glow";
  const release = () => {
    source.removeEventListener("dispose", release);
    glowMaterials.delete(source);
    glow.dispose();
  };
  source.addEventListener("dispose", release);
  glowMaterials.set(source, glow);
  return glow;
};

/** A merged lamp-pane mesh marked by the recipe; ordinary amber parts never carry this flag. */
export const isNightLampMesh = (object: Object3D): object is Mesh =>
  object instanceof Mesh && object.userData.nightLamp === true;

const nightLampMeshesOf = (root: Object3D) => {
  const meshes: Mesh[] = [];
  root.traverse(object => { if (isNightLampMesh(object)) meshes.push(object); });
  return meshes;
};

/**
 * Swaps only the marked lamp meshes between their authored material and the warm glow. Idempotent,
 * so it can run every frame during the day/night transition; day materials stay untouched.
 */
export const updateNightLampGlow = (root: Object3D, glowing: boolean) => {
  const meshes = (root.userData.nightLampMeshes ??= nightLampMeshesOf(root)) as Mesh[];
  for (const mesh of meshes) {
    if (!(mesh.material instanceof MeshStandardMaterial) || mesh.userData.nightLampLit === glowing) continue;
    const base = mesh.userData.nightLampBaseMaterial as MeshStandardMaterial | undefined;
    if (!base) mesh.userData.nightLampBaseMaterial = mesh.material;
    else mesh.material = base;
    mesh.userData.nightLampLit = glowing;
    if (glowing) mesh.material = nightLampGlowMaterial(mesh.userData.nightLampBaseMaterial);
  }
};
