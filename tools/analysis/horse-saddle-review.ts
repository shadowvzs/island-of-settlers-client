import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Matrix4, Quaternion, Vector3 } from "three";

import { type Document, NodeIO } from "../../../island-of-settlers-worker-generation/node_modules/@gltf-transform/core/dist/index.js";
import { ALL_EXTENSIONS } from "../../../island-of-settlers-worker-generation/node_modules/@gltf-transform/extensions/dist/index.js";
import { MeshoptDecoder, MeshoptEncoder } from "../../../island-of-settlers-worker-generation/node_modules/meshoptimizer/index.js";

const root = resolve(import.meta.dirname, "../../..");
const output = resolve(process.argv[2] ?? "../resources/project-reviews/horse-saddle-2026-10-26");
const repair = process.argv.includes("--repair");
await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });

const horseParts = (document: Document) => {
  const nodes = document.getRoot().listNodes();
  const mesh = nodes.find(node => node.getMesh() && node.getSkin())!;
  const saddle = nodes.find(node => node.getName() === "Saddle")!;
  const primitive = mesh.getMesh()!.listPrimitives().find(primitive => primitive.getMaterial()?.getName() === "saddle")!;
  const joints = mesh.getSkin()!.listJoints();
  assert.ok(saddle && primitive, "Horse saddle or skin is missing");
  const parent = joints.indexOf(saddle.getParentNode()!);
  assert.ok(parent >= 0, "Saddle parent is not a skin joint");
  return { joints, mesh, parent, primitive, saddle };
};

/** Contract excludes only the intentionally changed tack weights. */
const contract = (document: Document) => ({
  nodes: document.getRoot().listNodes().map(node => ({ name: node.getName(), matrix: node.getMatrix(),
    children: node.listChildren().map(child => child.getName()) })),
  skins: document.getRoot().listSkins().map(skin => ({ joints: skin.listJoints().map(joint => joint.getName()),
    bind: Array.from(skin.getInverseBindMatrices()!.getArray()!) })),
  meshes: document.getRoot().listMeshes().map(mesh => mesh.listPrimitives().map(primitive => ({
    material: primitive.getMaterial()?.getName(), indices: Array.from(primitive.getIndices()!.getArray()!),
    attributes: primitive.listSemantics().filter(semantic => primitive.getMaterial()?.getName() !== "saddle" ||
      !["JOINTS_0", "WEIGHTS_0"].includes(semantic)).map(semantic => ({ semantic,
      values: Array.from(primitive.getAttribute(semantic)!.getArray()!) }))
  }))),
  animations: document.getRoot().listAnimations().map(animation => ({ name: animation.getName(),
    channels: animation.listChannels().map(channel => ({ node: channel.getTargetNode()!.getName(),
      path: channel.getTargetPath(), interpolation: channel.getSampler()!.getInterpolation(),
      time: Array.from(channel.getSampler()!.getInput()!.getArray()!),
      values: Array.from(channel.getSampler()!.getOutput()!.getArray()!) })) })),
  textures: document.getRoot().listTextures().map(texture => ({ name: texture.getName(),
    hash: createHash("sha256").update(texture.getImage()!).digest("hex") }))
});

const deformation = (document: Document) => {
  const { joints, mesh, parent, primitive, saddle } = horseParts(document);
  const positions = primitive.getAttribute("POSITION")!, indices = primitive.getAttribute("JOINTS_0")!;
  const weights = primitive.getAttribute("WEIGHTS_0")!, binds = mesh.getSkin()!.getInverseBindMatrices()!;
  const nodes = document.getRoot().listNodes(), rest = nodes.map(node => node.getMatrix());
  const restore = () => nodes.forEach((node, index) => node.setMatrix(rest[index]!));
  const skin = () => {
    const matrices = joints.map((joint, index) => new Matrix4().fromArray(joint.getWorldMatrix())
      .multiply(new Matrix4().fromArray(binds.getElement(index, []))));
    const inverseSeat = new Matrix4().fromArray(saddle.getWorldMatrix()).invert();
    return Array.from({ length: positions.getCount() }, (_, vertex) => {
      const point = new Vector3().fromArray(positions.getElement(vertex, [])), result = new Vector3();
      const influence = indices.getElement(vertex, []), values = weights.getElement(vertex, []);
      for (let slot = 0; slot < 4; slot++) if (values[slot]! > 0)
        result.addScaledVector(point.clone().applyMatrix4(matrices[influence[slot]!]!), values[slot]!);
      return result.applyMatrix4(inverseSeat);
    });
  };
  const reference = skin(), triangles = primitive.getIndices()!;
  const edges: [number, number, number][] = [];
  for (let index = 0; index < triangles.getCount(); index += 3) {
    const a = triangles.getScalar(index), b = triangles.getScalar(index + 1), c = triangles.getScalar(index + 2);
    for (const [first, last] of [[a, b], [b, c], [c, a]]) {
      const length = reference[first!]!.distanceTo(reference[last!]!);
      if (length > .0001) edges.push([first!, last!, length]);
    }
  }
  const clips = document.getRoot().listAnimations().map(animation => {
    let maxSeatRelativeDrift = 0, maxStretchRatio = 1;
    const duration = Math.max(...animation.listSamplers().map(sampler => sampler.getInput()!.getMax([])[0]!));
    for (let frame = 0; frame <= 48; frame++) {
      restore();
      const seconds = duration * frame / 48;
      for (const channel of animation.listChannels()) {
        const sampler = channel.getSampler()!, input = sampler.getInput()!, output = sampler.getOutput()!;
        let index = 0;
        while (index + 1 < input.getCount() && input.getScalar(index + 1) <= seconds) index++;
        const next = Math.min(index + 1, input.getCount() - 1), span = input.getScalar(next) - input.getScalar(index);
        const blend = span > 0 ? (seconds - input.getScalar(index)) / span : 0;
        const a = output.getElement(index, []), b = output.getElement(next, []), node = channel.getTargetNode()!;
        assert.equal(sampler.getInterpolation(), "LINEAR");
        if (channel.getTargetPath() === "rotation") node.setRotation(new Quaternion().fromArray(a)
          .slerp(new Quaternion().fromArray(b), blend).toArray());
        else if (channel.getTargetPath() === "translation") node.setTranslation(new Vector3().fromArray(a)
          .lerp(new Vector3().fromArray(b), blend).toArray());
        else assert.fail(`Unsupported horse track ${channel.getTargetPath()}`);
      }
      const points = skin();
      points.forEach((point, index) => { maxSeatRelativeDrift = Math.max(maxSeatRelativeDrift,
        point.distanceTo(reference[index]!)); });
      for (const [first, last, length] of edges)
        maxStretchRatio = Math.max(maxStretchRatio, points[first]!.distanceTo(points[last]!) / length);
    }
    return { clip: animation.getName(), samples: 49, maxSeatRelativeDrift, maxStretchRatio };
  });
  restore();
  const influenceNames = new Set<string>();
  for (let vertex = 0; vertex < positions.getCount(); vertex++) {
    const ids = indices.getElement(vertex, []), values = weights.getElement(vertex, []);
    for (let slot = 0; slot < 4; slot++) if (values[slot]! > .0001) influenceNames.add(joints[ids[slot]!]!.getName());
  }
  return { clips, influences: [...influenceNames], seatJoint: joints[parent]!.getName(), vertices: positions.getCount() };
};

await mkdir(resolve(output, "original"), { recursive: true });
const reports = [];
for (const [quality, file] of [["high", "island-of-settlers-worker-generation/game_ready/mounts/horse/model.glb"],
  ["minimal", "island-of-settlers-client/assets/mounts/horse-minimal.glb"]]) {
  const path = resolve(root, file!), document = await io.read(path), before = deformation(document);
  const original = contract(document);
  if (repair) {
    await copyFile(path, resolve(output, `original/horse-${quality}.glb`), constants.COPYFILE_EXCL);
    const { parent, primitive } = horseParts(document);
    const indices = primitive.getAttribute("JOINTS_0")!, weights = primitive.getAttribute("WEIGHTS_0")!;
    for (let vertex = 0; vertex < indices.getCount(); vertex++) {
      indices.setElement(vertex, [parent, 0, 0, 0]); weights.setElement(vertex, [1, 0, 0, 0]);
    }
    await io.write(path, document);
  }
  const saved = await io.read(path), after = deformation(saved);
  assert.deepEqual(contract(saved), original, "Geometry, body skin, rig, clips or textures changed");
  for (const clip of after.clips) {
    assert.ok(clip.maxSeatRelativeDrift < .00001, `${quality} ${clip.clip}: tack moves away from rider attachment`);
    assert.ok(clip.maxStretchRatio < 1.00001, `${quality} ${clip.clip}: saddle stretches`);
  }
  reports.push({ quality, file, repaired: repair, contractUnchanged: true, before, after,
    sha256: createHash("sha256").update(await readFile(path)).digest("hex") });
}
const reportFile = repair ? "asset-validation.json" : "current-validation.json";
await writeFile(resolve(output, reportFile), JSON.stringify(reports, null, 2));
console.log(JSON.stringify(reports, null, 2));
