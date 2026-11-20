import {
  BoxGeometry, Color, DoubleSide, Float32BufferAttribute, Group, Matrix4, Mesh,
  MeshStandardMaterial, Quaternion, Vector3
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import {
  LIGHTER_OAR_INBOARD, LIGHTER_OAR_LENGTH
} from "../../../render-common/ships/lighter-dimensions";
import { SHIP_DECK } from "../../../render-common/ships/ship-deck-layout";
import { SAILING_SHIP_HULL_BEAM, SAILING_SHIP_SCALE } from "../../../render-common/ships/ship-dimensions";
import type { ShipFrame } from "../../../render-common/ships/ship-frame";
import type { WorkerNation } from "../../../render-common/workers/worker-unit";
import {
  LIGHTER_BOXES, LIGHTER_PASSENGER_SEATS, lighterCargoIndices, type LighterPlace, lighterPlaceAt
} from "../../../shared/settlement/harbour-lighters";
import type { BoatGrip } from "./boat-worker-pose";
import {
  BARGE_DRY_FLOOR_Y,   buildBargeHull, buildLadder, buildOar, oarlockOf,
ROWER_SEATS, SEAT_Y
} from "./harbour-barge-geometry";
import { createSmallBoatCoinCargo } from "./small-boat-coin-cargo";
import type { SmallBoatPeople, SmallBoatPerson } from "./three-small-boat-people";

/** Harbour-owned lighters share the population body pool and one real paddler per boat. */
const CRATE = 0xb1a384;
const STROKES_PER_SECOND = .5;
/** Oar sweep (radians either side), the blade's dip on the drive and lift on the recovery (direction share). */
const SWEEP = .5;
const DIP = .17;
const LIFT = .08;
const HIP_Y = SEAT_Y + .05;
/** How fast a barge turns round at the landing or alongside (radians per second). */
const TURN_RATE = 2.4;

const box = new BoxGeometry(1, 1, 1);
/** Up to four crates between the oarsmen. */
const buildCrates = () => {
  const pieces = Array.from({ length: LIGHTER_BOXES }, (_, index) => {
    const position = new Vector3((index % 2 - .5) * .34, BARGE_DRY_FLOOR_Y + .14, (Math.floor(index / 2) - .5) * .34 + .1);
    const piece = box.clone().applyMatrix4(new Matrix4().compose(position, new Quaternion(),
      new Vector3(.3, .26, .3))).toNonIndexed();
    const tint = new Color(CRATE), colors: number[] = [];
    for (let vertex = 0; vertex < piece.attributes.position!.count; vertex++) colors.push(tint.r, tint.g, tint.b);
    piece.setAttribute("color", new Float32BufferAttribute(colors, 3));
    return piece;
  });
  const geometry = mergeGeometries(pieces, false)!;
  pieces.forEach(piece => piece.dispose());
  return geometry;
};

interface Rower { person?: SmallBoatPerson; grips: BoatGrip[]; oarlocks: Vector3[]; oars: Mesh[] }
interface LighterModel {
  coinCargo: ReturnType<ReturnType<typeof createSmallBoatCoinCargo>["create"]>;
  cargo: Mesh; ladder: Mesh; bench: Mesh; material: MeshStandardMaterial; passengers: (SmallBoatPerson | undefined)[];
  root: Group; rower: Rower; time: number; yaw?: number;
}
const FORWARD = new Vector3(0, 0, 1);
const direction = new Vector3(), handle = new Vector3(), blade = new Vector3();
/** Points a unit-length mesh along +z from `from` to `to`. */
const span = (mesh: Mesh, from: Vector3, to: Vector3) => {
  direction.subVectors(to, from);
  const length = direction.length();
  mesh.position.copy(from);
  mesh.quaternion.setFromUnitVectors(FORWARD, direction.multiplyScalar(1 / Math.max(length, 1e-6)));
  mesh.scale.set(1, 1, length);
};

const poseRower = (rower: Rower, phase: number, rowing: boolean, nation: WorkerNation,
  identity: number, opacity: number) => {
  const sweep = rowing ? -SWEEP * Math.cos(phase) : 0;
  const rise = rowing ? LIFT * Math.max(0, -Math.sin(phase)) - DIP * Math.max(0, Math.sin(phase)) : .04;
  rower.oarlocks.forEach((lock, index) => {
    direction.set(Math.sign(lock.x) * Math.cos(sweep), rise, -Math.sin(sweep)).normalize();
    handle.copy(lock).addScaledVector(direction, -LIGHTER_OAR_INBOARD);
    blade.copy(handle).addScaledVector(direction, LIGHTER_OAR_LENGTH);
    span(rower.oars[index]!, handle, blade);
    const grip = rower.grips[index === 0 ? 1 : 0]!;
    grip.point.copy(handle).addScaledVector(direction, .1); grip.axis.copy(direction);
  });
  rower.person?.update({ seat: new Vector3(0, HIP_Y, ROWER_SEATS[0]), facing: Math.PI,
    lean: rowing ? .1 * Math.cos(phase) : 0, grips: rower.grips, nation, identity, opacity, visible: opacity > 0 });
};

/** Height of the ship's deck above the water (tiles) and how far up the barge's side the ladder starts. */
const DECK_HEIGHT = SHIP_DECK.floorY * SAILING_SHIP_SCALE;
const LADDER_FOOT = .2;
const ladderFoot = new Vector3(), riderAt = new Vector3();
/**
 * Ferried passengers on their seats, or climbing the ship's ladder: it stands against the hull side nearest the
 * barge (in the barge's own frame) while anyone climbs, and the climber faces the hull.
 */
const placeRiders = (model: LighterModel, ship: ShipFrame, at: LighterPlace, nation: WorkerNation, time: number) => {
  const { root } = model, dx = ship.x - root.position.x, dz = ship.z - root.position.z, yaw = root.rotation.y;
  // The ship's middle in the barge's frame (the inverse of its turn about y).
  const localX = dx * Math.cos(yaw) - dz * Math.sin(yaw), localZ = dx * Math.sin(yaw) + dz * Math.cos(yaw);
  const distance = Math.hypot(localX, localZ) || 1, reach = Math.max(.5, distance - SAILING_SHIP_HULL_BEAM / 2 - .05);
  ladderFoot.set(localX / distance * reach, LADDER_FOOT, localZ / distance * reach);
  const facing = Math.atan2(localX, localZ);
  model.ladder.visible = at.riders.some(rider => rider.climb > 0);
  model.ladder.position.copy(ladderFoot);
  model.ladder.rotation.y = facing;
  model.ladder.scale.y = DECK_HEIGHT - LADDER_FOOT + .1;
  model.bench.visible = at.riders.length > 0;
  model.passengers.forEach((passenger, seat) => {
    const rider = at.riders.find(each => each.seat === seat), point = LIGHTER_PASSENGER_SEATS[seat]!;
    if (!rider) { passenger?.update({ seat: new Vector3(), facing: 0, identity: 0, visible: false }); return; }
    const climbing = rider.climb > 0;
    riderAt.set(point.x, HIP_Y, point.z);
    if (climbing) riderAt.set(ladderFoot.x, LADDER_FOOT + .45 + rider.climb * (DECK_HEIGHT - LADDER_FOOT),
      ladderFoot.z).addScaledVector(ladderFoot, -.12 / reach);
    passenger?.update({ seat: riderAt, facing: climbing ? facing : 0,
      identity: ship.lighterWork?.passengerIds?.[rider.passenger] ?? ship.id * 100 + rider.passenger,
      nation, opacity: at.opacity, visible: true, climb: climbing ? rider.climb : undefined, time });
  });
};
/** Turns `from` towards `to` by at most `step` radians (the short way round). */
const turnTowards = (from: number, to: number, step: number) => {
  const difference = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + Math.sign(difference) * Math.min(Math.abs(difference), step);
};

export const createThreeHarbourLighters = (detailed: boolean, people?: SmallBoatPeople) => {
  const group = new Group(); group.name = "harbour_lighters";
  const hull = buildBargeHull(detailed, true), crates = buildCrates(), models = new Map<string, LighterModel>();
  const coinCargo = createSmallBoatCoinCargo(detailed);
  const ladderGeometry = buildLadder(), oar = buildOar(detailed), benchGeometry = new BoxGeometry(.7, .055, .13);
  const benchColors = new Float32Array(benchGeometry.attributes.position!.count * 3), benchColor = new Color(0xa07c55);
  for (let vertex = 0; vertex < benchGeometry.attributes.position!.count; vertex++)
    benchColors.set([benchColor.r, benchColor.g, benchColor.b], vertex * 3);
  benchGeometry.setAttribute("color", new Float32BufferAttribute(benchColors, 3));
  const verticesPerCrate = crates.attributes.position!.count / LIGHTER_BOXES;
  const create = (time: number): LighterModel => {
    const material = new MeshStandardMaterial({ roughness: .88, side: DoubleSide, transparent: true, vertexColors: true });
    const root = new Group(), cargo = new Mesh(crates.clone(), material), hullMesh = new Mesh(hull, material);
    hullMesh.castShadow = detailed;
    const oarlocks = [1, -1].map(side => oarlockOf(ROWER_SEATS[0], side));
    const oars = oarlocks.map(() => new Mesh(oar, material));
    const rower = { person: people?.create(root, "paddler"), oars, oarlocks,
      grips: oarlocks.map(() => ({ axis: new Vector3(), point: new Vector3() })) };
    const passengers = LIGHTER_PASSENGER_SEATS.map(() => people?.create(root, "passenger"));
    const ladder = new Mesh(ladderGeometry, material), bench = new Mesh(benchGeometry, material);
    const coins = coinCargo.create(material);
    bench.position.set(0, SEAT_Y, LIGHTER_PASSENGER_SEATS[0]!.z);
    root.add(hullMesh, cargo, coins.root, ladder, bench, ...oars); group.add(root);
    return { cargo, coinCargo: coins, ladder, bench, material, passengers, root, rower, time };
  };
  const dispose = (model: LighterModel) => {
    model.rower.person?.dispose(); model.passengers.forEach(person => person?.dispose());
    model.coinCargo.dispose();
    model.root.removeFromParent(); model.cargo.geometry.dispose(); model.material.dispose();
  };
  /** Places lighter `index` of the ship's job where its plan says it is now. */
  const place = (model: LighterModel, ship: ShipFrame, index: number, at: LighterPlace, time: number, nation: WorkerNation) => {
    const work = ship.lighterWork!, { alongside, landing } = work.boats[index]!;
    model.root.position.set(landing.x + (alongside.x - landing.x) * at.share, ship.y,
      landing.z + (alongside.z - landing.z) * at.share);
    // Bow first both ways: out to the ship unladen when unloading (laden when loading), back the other way.
    const towardsShip = Math.atan2(alongside.x - landing.x, alongside.z - landing.z);
    const outward = work.unloading ? at.boxes === 0 : at.boxes > 0;
    const heading = at.rowing && !outward ? towardsShip + Math.PI : towardsShip;
    model.yaw = model.yaw === undefined ? heading : turnTowards(model.yaw, at.rowing ? heading : model.yaw,
      TURN_RATE * Math.max(0, time - model.time));
    model.time = time;
    model.root.rotation.y = model.yaw;
    model.material.opacity = at.opacity;
    model.material.depthWrite = at.opacity >= 1;
    model.cargo.geometry.setDrawRange(0, at.boxes * verticesPerCrate);
    const cargo = lighterCargoIndices(work.plan, index, work.elapsed, work.unloading)
      .flatMap(box => work.manifest?.[box] ? [work.manifest[box]!] : []);
    model.cargo.visible = !model.coinCargo.update(cargo, at.opacity);
    const phase = time * Math.PI * 2 * STROKES_PER_SECOND + index;
    poseRower(model.rower, phase, at.rowing, nation, 2_300_000_000 + ship.id * 4 + index, at.opacity);
    placeRiders(model, ship, at, nation, time);
  };
  const update = (ships: readonly ShipFrame[], time: number, nation: WorkerNation = "roman") => {
    const active = new Set<string>();
    for (const ship of ships) {
      const work = ship.lighterWork;
      if (!work) continue;
      for (const index of work.boats.keys()) {
        const at = lighterPlaceAt(work.plan, index, work.elapsed, work.unloading);
        if (!at) continue;
        const key = `${ship.id}:${index}`, model = models.get(key) ?? create(time);
        models.set(key, model);
        active.add(key);
        place(model, ship, index, at, time, nation);
      }
    }
    for (const [key, model] of models) if (!active.has(key)) { dispose(model); models.delete(key); }
  };
  return {
    dispose: () => {
      for (const model of models.values()) dispose(model);
      models.clear(); coinCargo.dispose(); hull.dispose(); crates.dispose(); oar.dispose(); ladderGeometry.dispose(); benchGeometry.dispose();
    },
    group, update
  };
};
