import {
  BoxGeometry, type BufferGeometry, CircleGeometry, DataTexture, DoubleSide, Group, Mesh, MeshStandardMaterial,
  RepeatWrapping
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** The cast net beside a fishing skiff (FISHER-BOAT L6): alpha-tested knotted twine and cork floats. */
const MESH_CELLS = 64, MESH_LINE = 3, MESH_REPEAT = 5, CORKS = 14;
const NET_CAST = .13;
export const NET_HAUL = .74, NET_LIFT = .07, NET_RADIUS = .85, NET_SIDE = .95;
/** Below this spread the hauled net (and its catch) is aboard; above it the net never shrinks past it. */
export const NET_ABOARD = .15;
const NET_MIN_DRAWN = .4;

/** Net spread on the water: opens while cast, lies during the soak, closes while hauled. */
export const netSpread = (progress: number) => {
  if (progress < NET_CAST) return progress / NET_CAST;
  if (progress < NET_HAUL) return 1;
  return Math.max(0, 1 - (progress - NET_HAUL) / (1 - NET_HAUL));
};

/** A knotted square mesh: opaque twine lines, cut-out holes (alpha test, no blending pass). */
const createNetTexture = () => {
  const pixels = new Uint8Array(MESH_CELLS * MESH_CELLS * 4);
  for (let y = 0; y < MESH_CELLS; y++) for (let x = 0; x < MESH_CELLS; x++) {
    const twine = x % (MESH_CELLS / 4) < MESH_LINE || y % (MESH_CELLS / 4) < MESH_LINE;
    // Three.js reads an alpha map from its green channel.
    const value = twine ? 255 : 0;
    pixels.set([value, value, value, 255], (y * MESH_CELLS + x) * 4);
  }
  const texture = new DataTexture(pixels, MESH_CELLS, MESH_CELLS);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.repeat.set(MESH_REPEAT, MESH_REPEAT);
  texture.needsUpdate = true;
  return texture;
};

/** Cork floats around the net's rim (merged into one geometry). */
const createCorkRing = (): BufferGeometry => {
  const corks = Array.from({ length: CORKS }, (_, index) => {
    const angle = index / CORKS * Math.PI * 2;
    return new BoxGeometry(.07, .05, .11).rotateY(-angle).translate(Math.cos(angle), 0, Math.sin(angle));
  });
  const geometry = mergeGeometries(corks, false)!;
  corks.forEach(cork => cork.dispose());
  return geometry;
};

/** Shared net resources; `create` returns one skiff's net group (hidden until cast). */
export const createFishingNetKit = (detailed: boolean) => {
  // Alpha-tested twine lifted above the wave crests: a blended sheet would sort behind the water.
  const texture = createNetTexture();
  const material = new MeshStandardMaterial({ alphaMap: texture, alphaTest: .5, color: 0x5a4a34, roughness: 1,
    side: DoubleSide });
  const corkMaterial = new MeshStandardMaterial({ color: 0xd9b56a, roughness: .9 });
  const disc = new CircleGeometry(1, detailed ? 20 : 10).rotateX(-Math.PI / 2);
  const corkRing = createCorkRing();
  const create = () => {
    const net = new Group(), corks = new Mesh(corkRing, corkMaterial);
    corks.position.y = .01;
    net.add(new Mesh(disc, material), corks);
    net.position.set(NET_SIDE, NET_LIFT, 0);
    return net;
  };
  /** Shows the net at its cast progress (hidden when absent or closed). */
  const pose = (net: Group, progress: number | undefined) => {
    const spread = progress === undefined ? 0 : netSpread(progress);
    // A closing net bunches up rather than shrinking to minified twine; it goes aboard at NET_ABOARD.
    const hauled = progress !== undefined && progress >= NET_HAUL;
    const drawn = hauled ? Math.max(NET_MIN_DRAWN, spread) : spread;
    net.visible = hauled ? spread > NET_ABOARD : spread > 0;
    net.scale.set(Math.max(.001, drawn * NET_RADIUS), 1, Math.max(.001, drawn * NET_RADIUS));
    return spread;
  };
  const dispose = () => {
    disc.dispose(); corkRing.dispose(); texture.dispose(); material.dispose(); corkMaterial.dispose();
  };
  return { create, dispose, pose };
};
