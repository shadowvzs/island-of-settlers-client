import {
  BufferAttribute, BufferGeometry, Group, type IUniform, Line, LineBasicMaterial, Mesh,
  Quaternion, type Raycaster, Vector3
} from "three";

import {
  FISHING_SKIFF_BEAM, FISHING_SKIFF_LENGTH, FISHING_SKIFF_OAR_INBOARD, FISHING_SKIFF_OAR_LENGTH
} from "../../../render-common/ships/fishing-skiff-dimensions";
import { FISHING_SKIFF_STOW_OFFSET, FISHING_SKIFF_STOW_ROTATION } from "../../../render-common/ships/fishing-skiff-stow";
import { LIGHTER_BEAM, LIGHTER_LENGTH } from "../../../render-common/ships/lighter-dimensions";
import type { FishingBoatFrame } from "../../../render-common/ships/ship-frame";
import type { WorkerAppearance, WorkerFrame, WorkerNation } from "../../../render-common/workers/worker-unit";
import { createSeabedShadowLayer } from "../three-seabed-shadows";
import type { BoatGrip } from "./boat-worker-pose";
import { createFishingSkiffSurface } from "./fishing-skiff-surface";
import { buildOar, oarlockOf, ROWER_SEATS, SEAT_Y } from "./harbour-barge-geometry";
import { createNationalBoatHulls } from "./national-harbour-boat";
import { createFishingCatch, createSkiffLanternKit } from "./three-fishing-boat-extras";
import { createFishingNetKit, NET_ABOARD, NET_HAUL, NET_LIFT, NET_SIDE } from "./three-fishing-boat-net";
import type { SmallBoatPeople, SmallBoatPerson } from "./three-small-boat-people";

/**
 * FISHER-BOAT L6 / FISHER-POLISH: each Fishery's skiff as the nation's harbour-boat hull scaled to the shared
 * skiff dimensions, two oars, a stern lantern, the fisher as its rower (population body), the net laid out
 * beside it and the catch. Minimal builds the low hull without shadows. Boats over water leave the sun
 * caster pass: their seabed shadow is the soft, depth-spread fish-school shadow (refraction presets only).
 * In the yard the skiff lies on its side, keel against a Fishery wall (`fishing-skiff-yard.ts`).
 */
const HULL_SCALE = new Vector3(FISHING_SKIFF_BEAM / LIGHTER_BEAM, .78, FISHING_SKIFF_LENGTH / LIGHTER_LENGTH);
const STOWED_SWEEP = 1.35;
const STROKES_PER_SECOND = .55, SWEEP = .5, DIP = .15, LIFT = .07;
const FORWARD = new Vector3(0, 0, 1);
/** Seabed shadow: half length = .55 × size (shader ellipse), a little past the hull ends. */
const SHADOW_SIZE = (FISHING_SKIFF_LENGTH / 2 + .1) / .55, SHADOW_STRENGTH = 1.8, SHADOW_CAPACITY = 64;
const SEAT = new Vector3(0, SEAT_Y * HULL_SCALE.y + .05, ROWER_SEATS[0] * HULL_SCALE.z);
const LANTERN_MOUNT = new Vector3(0, .08, .6);
const NO_TURN = new Quaternion(), NO_OFFSET = new Vector3();
const direction = new Vector3(), handle = new Vector3(), blade = new Vector3();

interface SkiffModel {
  personIdentity?: number;
  personAppearance?: WorkerAppearance;
  grips: BoatGrip[];
  hull: Mesh;
  lantern: Group;
  nation: WorkerNation;
  net: Group;
  rope: Line;
  oarlocks: Vector3[];
  oars: Mesh[];
  rower?: SmallBoatPerson;
  root: Group;
}

const scaledOarlock = (side: number) => {
  // The fisher faces the bow, so the locks must be ahead of the seat as well.
  const lock = oarlockOf(ROWER_SEATS[0] + .30, side);
  return new Vector3(lock.x * HULL_SCALE.x, lock.y * HULL_SCALE.y, lock.z * HULL_SCALE.z);
};

const placeOar = (model: SkiffModel, index: number, sweep: number, rise: number) => {
  const lock = model.oarlocks[index]!, side = Math.sign(lock.x);
  direction.set(side * Math.cos(sweep), rise, -Math.sin(sweep)).normalize();
  handle.copy(lock).addScaledVector(direction, -FISHING_SKIFF_OAR_INBOARD);
  blade.copy(handle).addScaledVector(direction, FISHING_SKIFF_OAR_LENGTH);
  const oar = model.oars[index]!;
  oar.position.copy(handle);
  oar.quaternion.setFromUnitVectors(FORWARD, direction);
  const grip = model.grips[index]!;
  grip.point.copy(handle).addScaledVector(direction, .08); grip.axis.copy(direction);
};

/** Oars row, lie shipped along the gunwales (net out, beached) or are hidden (yard). */
const poseOars = (model: SkiffModel, frame: FishingBoatFrame, phase: number) => {
  model.oars.forEach(oar => { oar.visible = !frame.stowed; });
  if (frame.stowed) return;
  const shipped = frame.net !== undefined || !frame.crewed;
  const restingSweep = shipped ? STOWED_SWEEP : 0;
  const sweep = frame.rowing ? -SWEEP * Math.cos(phase) : restingSweep;
  const rise = frame.rowing ? LIFT * Math.max(0, -Math.sin(phase)) - DIP * Math.max(0, Math.sin(phase)) : .05;
  model.oars.forEach((_, index) => placeOar(model, index, sweep, rise));
};

const poseHull = (model: SkiffModel, stowed: boolean) => {
  model.hull.quaternion.copy(stowed ? FISHING_SKIFF_STOW_ROTATION : NO_TURN);
  model.hull.position.copy(stowed ? FISHING_SKIFF_STOW_OFFSET : NO_OFFSET);
  model.lantern.visible = !stowed;
};

const hits: { distance: number }[] = [];

export const createThreeFishingBoats = (
  detailed: boolean, people?: SmallBoatPeople, shared?: Record<string, IUniform>
) => {
  const group = new Group(); group.name = "fishing_boats";
  // Beached, yard and dropped boats cast into the sun map; boats over water draw the soft seabed shadow.
  const landed = new Group(), afloat = new Group();
  landed.name = "fishing_boats_landed"; afloat.name = "fishing_boats_afloat";
  const catches = createFishingCatch(detailed), lanterns = createSkiffLanternKit();
  const nets = createFishingNetKit(detailed);
  group.add(landed, afloat, catches.mesh);
  const seabed = detailed && shared ? createSeabedShadowLayer(shared, SHADOW_CAPACITY) : undefined;
  const hulls = createNationalBoatHulls("fishingSkiff", detailed);
  const models = new Map<number, SkiffModel>();
  const handlingPeople = new Map<number, { model: SkiffModel; yaw: number; kind: "launch" | "beach"; progress: number }>();
  const hullSurface = createFishingSkiffSurface(), hullMaterial = hullSurface.material;
  const ropeMaterial = new LineBasicMaterial({ color: 0x695638 });
  const oar = buildOar(detailed, .011, .05);
  const create = (nation: WorkerNation): SkiffModel => {
    const root = new Group(), hull = new Mesh(hulls.hullFor(nation), hullMaterial), net = nets.create();
    const lantern = lanterns.create();
    const ropeGeometry = new BufferGeometry();
    ropeGeometry.setAttribute("position", new BufferAttribute(new Float32Array(6), 3));
    const rope = new Line(ropeGeometry, ropeMaterial); rope.frustumCulled = false;
    root.name = `fishing_skiff_${nation}`;
    hull.scale.copy(HULL_SCALE); hull.castShadow = detailed;
    lantern.position.copy(LANTERN_MOUNT);
    const oarlocks = [1, -1].map(scaledOarlock);
    const oars = oarlocks.map(() => new Mesh(oar, hullMaterial));
    for (const mesh of oars) mesh.scale.set(1, 1, FISHING_SKIFF_OAR_LENGTH);
    root.add(hull, net, lantern, rope, ...oars);
    return { grips: oarlocks.map(() => ({ axis: new Vector3(), point: new Vector3() })), hull, lantern, nation, net,
      oarlocks, oars, rope, rower: people?.create(root, "paddler"), root };
  };
  const dispose = (model: SkiffModel) => { model.rower?.dispose(); model.rope.geometry.dispose(); model.root.removeFromParent(); };
  const modelFor = (frame: FishingBoatFrame) => {
    const nation = frame.nation ?? "roman", previous = models.get(frame.id);
    if (previous && previous.nation !== nation) { dispose(previous); models.delete(frame.id); }
    const model = models.get(frame.id) ?? create(nation);
    models.set(frame.id, model);
    return model;
  };
  const placeRoot = (model: SkiffModel, frame: FishingBoatFrame, time: number) => {
    const parent = frame.bed === undefined ? landed : afloat;
    if (model.root.parent !== parent) parent.add(model.root);
    if (frame.bed !== undefined) seabed?.add(frame.x, frame.bed, frame.z, SHADOW_SIZE, Math.PI / 2 - frame.yaw,
      Math.max(0, frame.y - frame.bed), 1, SHADOW_STRENGTH);
    const bob = frame.crewed ? Math.sin(time * 1.7 + frame.id) * .015 : 0;
    const progress = Math.max(0, Math.min(1, frame.handling?.progress ?? 0));
    let push = 0;
    if (frame.handling?.kind === "launch") push = .25 * progress;
    else if (frame.handling?.kind === "beach") push = .25 * (1 - progress);
    model.root.position.set(frame.x + Math.sin(frame.yaw) * push, frame.y + bob,
      frame.z + Math.cos(frame.yaw) * push);
    model.root.rotation.y = frame.yaw;
    model.root.updateMatrixWorld();
  };
  /** The catch: in the closing net while it is hauled, then in the boat bottom until the basket leaves. */
  const placeCatch = (model: SkiffModel, frame: FishingBoatFrame, spread: number) => {
    const hauling = frame.net !== undefined && frame.net >= NET_HAUL;
    if (hauling && spread > NET_ABOARD) catches.inNet(model.root.matrixWorld, spread);
    else if (hauling || frame.catch) catches.inBoat(model.root.matrixWorld);
  };
  const update = (frames: readonly FishingBoatFrame[], time: number, night = false,
    workers: readonly WorkerFrame[] = []) => {
    const active = new Set<number>();
    const appearances = new Map(workers.filter(worker => worker.actorId !== undefined)
      .map(worker => [worker.actorId!, { nation: worker.nation, variant: worker.variant }]));
    handlingPeople.clear();
    seabed?.clear(); catches.clear(); lanterns.setNight(night);
    for (const frame of frames) {
      const model = modelFor(frame);
      if (model.personIdentity !== frame.person) {
        model.personIdentity = frame.person;
        model.personAppearance = undefined;
      }
      model.personAppearance = appearances.get(frame.person) ?? model.personAppearance;
      active.add(frame.id);
      placeRoot(model, frame, time);
      if (frame.handling) handlingPeople.set(frame.person, { model, yaw: frame.yaw, ...frame.handling });
      poseHull(model, Boolean(frame.stowed));
      const phase = time * Math.PI * 2 * STROKES_PER_SECOND + frame.id;
      poseOars(model, frame, phase);
      const spread = nets.pose(model.net, frame.net);
      placeCatch(model, frame, spread);
      model.rower?.update({ facing: 0, fisherMotion: true, grips: model.grips, identity: frame.person,
        appearance: model.personAppearance, net: frame.net,
        lean: frame.rowing ? -.1 * Math.cos(phase) : 0, nation: model.nation, seat: SEAT, strokePhase: phase, time,
        preload: Boolean(frame.handling), visible: frame.crewed });
      const hand = frame.net === undefined ? undefined : model.rower?.handWorld(handle);
      model.rope.visible = Boolean(hand && frame.net !== undefined && spread > NET_ABOARD);
      if (model.rope.visible && hand) {
        const start = model.root.worldToLocal(hand);
        const positions = model.rope.geometry.getAttribute("position") as BufferAttribute;
        positions.setXYZ(0, start.x, start.y, start.z);
        positions.setXYZ(1, NET_SIDE - spread * .35, NET_LIFT, 0);
        positions.needsUpdate = true;
      }
    }
    for (const [id, model] of models) if (!active.has(id)) { dispose(model); models.delete(id); }
    seabed?.commit(); catches.commit();
  };
  /** The nearest skiff hull under the ray: its id is the owning Fishery's uid. */
  const pickHit = (raycaster: Raycaster) => {
    let nearest: { distance: number; id: number } | undefined;
    for (const [id, model] of models) {
      hits.length = 0;
      model.hull.raycast(raycaster, hits as never);
      for (const hit of hits) if (!nearest || hit.distance < nearest.distance) nearest = { distance: hit.distance, id };
    }
    return nearest;
  };
  const handlingPose = (person: number) => {
    const entry = handlingPeople.get(person);
    if (!entry) return undefined;
    const { kind, model, progress, yaw } = entry;
    model.root.updateWorldMatrix(true, false);
    const at = model.root.localToWorld(new Vector3(0, 0, -.85));
    const left = model.root.localToWorld(new Vector3(.15, .32, -.62));
    const right = model.root.localToWorld(new Vector3(-.15, .32, -.62));
    const seat = model.root.localToWorld(SEAT.clone());
    const worldRotation = model.root.getWorldQuaternion(new Quaternion());
    const grips = model.grips.map(grip => ({ point: model.root.localToWorld(grip.point.clone()),
      axis: grip.axis.clone().applyQuaternion(worldRotation) })) as [BoatGrip, BoatGrip];
    const t = kind === "launch" ? (progress - .45) / .55 : 1 - progress / .55;
    const board = Math.max(0, Math.min(1, t));
    return { x: at.x, z: at.z, yaw, hands: [left, right] as const,
      boarding: { seat, facing: yaw, grips, progress: board * board * (3 - 2 * board) } };
  };
  return { casters: landed, group, handlingPose, pickHit, seabedShadows: seabed?.mesh, update, dispose: () => {
    seabed?.dispose(); catches.dispose(); lanterns.dispose(); nets.dispose();
    models.forEach(dispose); models.clear(); hulls.dispose();
    oar.dispose(); hullSurface.dispose(); ropeMaterial.dispose(); group.removeFromParent();
  } };
};
