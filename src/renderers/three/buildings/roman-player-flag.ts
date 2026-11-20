import {
  AnimationClip,
  BoxGeometry,
  DataTexture,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  type MeshStandardMaterial,
  NumberKeyframeTrack,
  PlaneGeometry,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace} from "three";

import { PLAYER_FLAG_PERIOD, PLAYER_FLAG_POSES, playerFlagVertex, playerFlagWaveWeights, playerFlagWindWeights }
  from "../../../render-common/buildings/player-flag-motion";
import { DEFAULT_PLAYER_COLOR } from "../../../render-common/settlement/player-color";

export const createPlayerFlagClothWeave = () => {
  const size = 32,
    pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const shade =
        215 + (x % 4 === 0 || y % 4 === 0 ? -18 : 12) + Math.round(Math.sin(x * 1.7 + y * 2.3) * 5);
      pixels.set([shade, shade, shade, 255], (y * size + x) * 4);
    }
  const texture = new DataTexture(pixels, size, size, RGBAFormat);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.repeat.set(4, 3);
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
};

/** Gravity base and sampled travelling folds share the runtime and exported wind animation. */
export const createRomanPlayerFlag = (
  cloth: MeshStandardMaterial,
  wood: MeshStandardMaterial,
  detailed: boolean
) => {
  const root = new Group();
  root.name = "player_flag_mount";
  const pole = new Mesh(new BoxGeometry(0.025, 0.64, 0.025), wood);
  pole.geometry.setAttribute(
    "color",
    new Float32BufferAttribute(
      new Float32Array(pole.geometry.attributes.position!.count * 3).fill(1),
      3
    )
  );
  pole.position.y = 0.12;
  root.add(pole);
  const geometry = new PlaneGeometry(0.43, 0.27, detailed ? 12 : 4, detailed ? 6 : 2);
  geometry.translate(0.215, 0.25, 0);
  const original = geometry.getAttribute("position").clone();
  const pose = (phase: number | null) => {
    const values = new Float32Array(original.array);
    for (let vertex = 0; vertex < original.count; vertex++) {
      values.set(playerFlagVertex(original.getX(vertex), original.getY(vertex), phase), vertex * 3);
    }
    return new Float32BufferAttribute(values, 3);
  };
  geometry.setAttribute("position", pose(null));
  geometry.computeVertexNormals();
  geometry.morphAttributes.position = Array.from({ length: PLAYER_FLAG_POSES },
    (_, index) => pose(index / PLAYER_FLAG_POSES * Math.PI * 2));
  geometry.morphAttributes.normal = geometry.morphAttributes.position.map((positions) => {
    const temporary = geometry.clone();
    temporary.morphAttributes = {};
    temporary.setAttribute("position", positions);
    temporary.computeVertexNormals();
    const normals = temporary.getAttribute("normal").clone();
    temporary.dispose();
    return normals;
  });
  const material = cloth.clone();
  const weave = createPlayerFlagClothWeave();
  material.vertexColors = false;
  material.map = weave;
  material.color.setRGB(...DEFAULT_PLAYER_COLOR);
  material.side = DoubleSide;
  material.roughness = 0.92;
  material.metalness = 0;
  const flag = new Mesh(geometry, material);
  flag.name = "player_flag_cloth";
  flag.castShadow = detailed;
  flag.userData.tintable = true;
  root.add(flag);
  const times = Array.from({ length: 49 }, (_, index) => index * PLAYER_FLAG_PERIOD / 48);
  const samples = times.map(time => {
    const weights = new Array<number>(PLAYER_FLAG_POSES).fill(0);
    // Bake one loop of the same progressing cloth wave used at runtime.
    const phase = time / PLAYER_FLAG_PERIOD * Math.PI * 2;
    playerFlagWaveWeights(time, .84 + Math.sin(phase) * .1 + Math.sin(phase * 2) * .06, weights);
    return weights;
  });
  samples[samples.length - 1] = [...samples[0]!];
  const clip = new AnimationClip("wind", PLAYER_FLAG_PERIOD,
    Array.from({ length: PLAYER_FLAG_POSES }, (_, index) => new NumberKeyframeTrack(
      `player_flag_cloth.morphTargetInfluences[${index}]`, times,
      samples.map(weights => weights[index]!)
    )));
  const update = (
    time: number,
    strength = 1,
    direction = 0,
    color: [number, number, number] = DEFAULT_PLAYER_COLOR
  ) => {
    playerFlagWindWeights(time, strength, flag.morphTargetInfluences!);
    flag.rotation.y = direction;
    material.color.setRGB(...color);
  };
  return {
    root,
    clip,
    update,
    dispose: () => {
      weave.dispose();
      material.dispose();
    }
  };
};
