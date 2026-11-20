import { BoxGeometry, Color, DoubleSide, Float32BufferAttribute, Group, Matrix4, Mesh,
  MeshStandardMaterial, Quaternion, Vector3 } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { LIGHTER_OAR_INBOARD, LIGHTER_OAR_LENGTH } from "../../../render-common/ships/lighter-dimensions";
import type { ShuttleBoatFrame } from "../../../render-common/ships/ship-frame";
import type { WorkerNation } from "../../../render-common/workers/worker-unit";
import { LIGHTER_BOXES } from "../../../shared/settlement/harbour-lighters";
import { shuttleHandling, shuttleRouteLength } from "../../../shared/settlement/harbour-shuttle-handling";
import { deckCargoPresentation } from "../../../shared/settlement/ship-cargo-presentation";
import { shuttlePersonId } from "../../../shared/settlement/small-boat-crew";
import { type BoatGrip } from "./boat-worker-pose";
import { BARGE_DRY_FLOOR_Y, buildOar, oarlockOf, ROWER_SEATS, SEAT_Y } from "./harbour-barge-geometry";
import { createNationalBoatHulls } from "./national-harbour-boat";
import { createSmallBoatCoinCargo } from "./small-boat-coin-cargo";
import type { SmallBoatPeople, SmallBoatPerson } from "./three-small-boat-people";

const STROKES_PER_SECOND = .5, SWEEP = .5, DIP = .17, LIFT = .08;
const FORWARD = new Vector3(0, 0, 1), UP = new Vector3(0, 1, 0);
const SEAT = new Vector3(0, SEAT_Y + .05, ROWER_SEATS[0]);
const direction = new Vector3(), handle = new Vector3(), blade = new Vector3();
const gangwayFrom = new Vector3(), gangwayTo = new Vector3();
const buildCrates = () => {
  const box = new BoxGeometry(1, 1, 1), height = .26;
  const pieces = Array.from({ length: LIGHTER_BOXES }, (_, index) => {
    const position = new Vector3((index % 2 - .5) * .34, BARGE_DRY_FLOOR_Y + height / 2 + .01,
      (Math.floor(index / 2) - .5) * .34 + .1);
    const piece = box.clone().applyMatrix4(new Matrix4().compose(position, new Quaternion(),
      new Vector3(.3, height, .3))).toNonIndexed();
    const tint = new Color(0xb1a384), colors = new Float32Array(piece.attributes.position!.count * 3);
    for (let vertex = 0; vertex < piece.attributes.position!.count; vertex++) colors.set([tint.r, tint.g, tint.b], vertex * 3);
    piece.setAttribute("color", new Float32BufferAttribute(colors, 3)); return piece;
  });
  const geometry = mergeGeometries(pieces, false)!; pieces.forEach(piece => piece.dispose()); box.dispose(); return geometry;
};
interface Model {
  coinCargo: ReturnType<ReturnType<typeof createSmallBoatCoinCargo>["create"]>;
  cargo: Mesh; gangway: Mesh; material: MeshStandardMaterial; nation: WorkerNation; root: Group;
  oars: Mesh[]; oarlocks: Vector3[]; grips: BoatGrip[]; paddler?: SmallBoatPerson;
}
const span = (mesh: Mesh, from: Vector3, to: Vector3) => {
  direction.subVectors(to, from); const length = direction.length(); mesh.position.copy(from);
  mesh.quaternion.setFromUnitVectors(FORWARD, direction.multiplyScalar(1 / Math.max(length, 1e-6)));
  mesh.scale.set(1, 1, length);
};
/** National hulls and exactly one canonical, independently skinned population paddler. */
export const createThreeHarbourShuttles = (detailed: boolean, people?: SmallBoatPeople) => {
  const group = new Group(); group.name = "harbour_shuttles";
  const crates = buildCrates(), models = new Map<number, Model>();
  const hulls = createNationalBoatHulls("lighter", detailed);
  const coinCargo = createSmallBoatCoinCargo(detailed);
  const plank = new BoxGeometry(1, 1, 1), oar = buildOar(detailed);
  const plankMaterial = new MeshStandardMaterial({ color: 0x92704c, roughness: .95 });
  const verticesPerCrate = crates.attributes.position!.count / LIGHTER_BOXES;
  const create = (nation: WorkerNation): Model => {
    const hull = hulls.hullFor(nation);
    const material = new MeshStandardMaterial({ roughness: .88, side: DoubleSide, vertexColors: true });
    const root = new Group(), cargo = new Mesh(crates.clone(), material), hullMesh = new Mesh(hull, material);
    const gangway = new Mesh(plank, plankMaterial); gangway.name = "boat_loading_gangway";
    root.name = `harbour_shuttle_${nation}`; hullMesh.castShadow = detailed;
    const oarlocks = [1, -1].map(side => oarlockOf(ROWER_SEATS[0], side));
    const oars = oarlocks.map(() => new Mesh(oar, material));
    const coins = coinCargo.create(material);
    root.add(hullMesh, cargo, coins.root, gangway, ...oars); group.add(root);
    return { cargo, coinCargo: coins, gangway, grips: oarlocks.map(() => ({ axis: new Vector3(), point: new Vector3() })),
      material, nation, oarlocks, oars, paddler: people?.create(root, "paddler"), root };
  };
  const dispose = (model: Model) => {
    model.paddler?.dispose(); model.coinCargo.dispose();
    model.root.removeFromParent(); model.cargo.geometry.dispose(); model.material.dispose();
  };
  const update = (frames: readonly ShuttleBoatFrame[], time: number) => {
    const active = new Set<number>();
    for (const frame of frames) {
      const nation = frame.nation ?? "roman", previous = models.get(frame.id);
      if (previous && previous.nation !== nation) { dispose(previous); models.delete(frame.id); }
      const model = models.get(frame.id) ?? create(nation); models.set(frame.id, model); active.add(frame.id);
      model.root.position.set(frame.x, frame.y + Math.sin(time * 1.6 + frame.id) * .018, frame.z);
      model.root.rotation.y = frame.yaw; model.gangway.visible = Boolean(frame.gangway);
      if (frame.gangway) {
        const from = gangwayFrom.set(frame.gangway.from.x, frame.gangway.from.y, frame.gangway.from.z)
          .sub(model.root.position).applyAxisAngle(UP, -frame.yaw);
        const to = gangwayTo.set(frame.gangway.to.x, frame.gangway.to.y, frame.gangway.to.z)
          .sub(model.root.position).applyAxisAngle(UP, -frame.yaw);
        direction.subVectors(to, from); const length = direction.length();
        model.gangway.position.copy(from).add(to).multiplyScalar(.5);
        model.gangway.quaternion.setFromUnitVectors(FORWARD, direction.multiplyScalar(1 / Math.max(length, 1e-6)));
        model.gangway.scale.set(.28, .045, length);
      }
      model.cargo.geometry.setDrawRange(0, Math.min(LIGHTER_BOXES, frame.boxes) * verticesPerCrate);
      model.cargo.visible = frame.boxes > 0;
      const manifest = deckCargoPresentation(frame.cargoManifest, frame.boxes, frame.porterWork?.unloading === true);
      if (model.coinCargo.update(manifest)) model.cargo.visible = false;
      const work = frame.porterWork, aboard = !work || shuttleHandling(work.boxes, shuttleRouteLength(work.route),
        work.unloading, work.elapsed, work.crew).aboard[0] === true;
      const phase = time * Math.PI * 2 * STROKES_PER_SECOND + frame.id, rowing = frame.rowing && aboard;
      const sweep = rowing ? -SWEEP * Math.cos(phase) : 0;
      const rise = rowing ? LIFT * Math.max(0, -Math.sin(phase)) - DIP * Math.max(0, Math.sin(phase)) : .04;
      model.oarlocks.forEach((lock, index) => {
        const side = Math.sign(lock.x);
        direction.set(side * Math.cos(sweep), rise, -Math.sin(sweep)).normalize();
        handle.copy(lock).addScaledVector(direction, -LIGHTER_OAR_INBOARD);
        blade.copy(handle).addScaledVector(direction, LIGHTER_OAR_LENGTH); span(model.oars[index]!, handle, blade);
        const grip = model.grips[index === 0 ? 1 : 0]!;
        grip.point.copy(handle).addScaledVector(direction, .1); grip.axis.copy(direction);
      });
      model.paddler?.update({ facing: Math.PI, grips: model.grips, identity: shuttlePersonId(frame.id),
        lean: rowing ? .1 * Math.cos(phase) : 0, nation, seat: SEAT, visible: aboard });
    }
    for (const [id, model] of models) if (!active.has(id)) { dispose(model); models.delete(id); }
  };
  return { group, update, dispose: () => {
    models.forEach(dispose); models.clear(); coinCargo.dispose(); crates.dispose(); oar.dispose(); plank.dispose(); plankMaterial.dispose();
    hulls.dispose();
  } };
};
