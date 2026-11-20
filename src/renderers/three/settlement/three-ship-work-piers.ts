import {
  BoxGeometry, BufferGeometry, Float32BufferAttribute, Group, Matrix4, Mesh, type MeshStandardMaterial, Quaternion, Vector3
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { BOAT_JETTY_DECK_WIDTH } from "../../../render-common/ships/lighter-dimensions";
import type { ShipSiteFrame } from "../../../render-common/ships/ship-frame";
import {
HARBOUR_PIER_DECK_WIDTH,
  harbourFixedPierEnd} from "../../../shared/settlement/settlement-harbour-pier-geometry";
import type { ShipWorkpoint } from "../../../shared/settlement/settlement-ship-workpoint";
import { addNationalBoatJetty } from "./national-boat-jetty";
import { advanceGangwayRun, type GangwayRun, isTroopGangwaySite, startGangwayRun } from "./three-gangway-deploy";

const DECK_WIDTH = HARBOUR_PIER_DECK_WIDTH;
const JETTY_WIDTH = BOAT_JETTY_DECK_WIDTH;
const GANGWAY_WIDTH = .5;
const PLANK_THICKNESS = .08;
const PLANK_DROP = .04;
const RAIL_HEIGHT = .32;
const UP = new Vector3(0, 1, 0);

interface Parts {
  add(position: Vector3, scale: Vector3, quaternion?: Quaternion): void;
}
interface PierLine { end: Vector3; fixedEnd: Vector3; start: Vector3 }
/** A drawn dock gangway or ramp; a troop gangway still running out holds its `run`. */
interface PierModel { key: string; mesh: Mesh; run?: GangwayRun; work: ShipWorkpoint }

/** The pier's walking line: shore to pier end, and where the fixed pier ends and the gangway starts. */
const pierLine = (work: ShipWorkpoint): PierLine => {
  const start = new Vector3(work.shore.x, work.shoreY, work.shore.z);
  const end = new Vector3(work.point.x, work.y, work.point.z);
  const fixed = harbourFixedPierEnd(work), fixedEnd = new Vector3(fixed.x, fixed.y, fixed.z);
  return { end, fixedEnd, start };
};
/** Preserve world-up: shortest-arc +Z alignment can roll a reverse-facing sloped deck upright. */
const along = (from: Vector3, to: Vector3) => {
  const forward = to.clone().sub(from).normalize(), right = new Vector3().crossVectors(UP, forward).normalize();
  if (!right.lengthSq()) right.set(1, 0, 0);
  const up = new Vector3().crossVectors(forward, right);
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(right, up, forward));
};

/** Planks from `from` to `to`: one per quarter tile on High, a single board on Minimal. */
const addPlanks = (parts: Parts, from: Vector3, to: Vector3, width: number, detailed: boolean) => {
  const length = from.distanceTo(to);
  if (length < 1e-6) return;
  const pieces = detailed ? Math.max(1, Math.ceil(length / .24)) : 1, rotation = along(from, to);
  for (let index = 0; index < pieces; index++) parts.add(
    from.clone().lerp(to, (index + .5) / pieces).add(new Vector3(0, -PLANK_DROP, 0).applyQuaternion(rotation)),
    new Vector3(width, PLANK_THICKNESS, length / pieces * (detailed ? .96 : 1)), rotation);
};
/** Posts every few metres down to the water, so a long harbour jetty stands as firmly as a short ramp. */
const addPosts = (parts: Parts, from: Vector3, to: Vector3, waterY: number, detailed: boolean) => {
  const direction = to.clone().sub(from), length = direction.length();
  if (length < 1e-6) return;
  const lateral = new Vector3(direction.z, 0, -direction.x).normalize().multiplyScalar(.27);
  const spans = Math.max(detailed ? 2 : 1, Math.ceil(length / (detailed ? 2.5 : 5)));
  for (let index = 0; index <= spans; index++) for (const side of [-1, 1]) {
    const top = from.clone().lerp(to, .2 + index / spans * .75).addScaledVector(lateral, side);
    const height = Math.max(.3, top.y - waterY + .5);
    parts.add(top.add(new Vector3(0, -height / 2, 0)), new Vector3(.075, height, .075));
  }
};
/** The gangway: a narrower board from the pier end to the hull, with hand rails on High. */
const addGangway = (parts: Parts, from: Vector3, to: Vector3, contact: Vector3, detailed: boolean) => {
  addPlanks(parts, from, to, GANGWAY_WIDTH, detailed);
  addPlanks(parts, to, contact, GANGWAY_WIDTH, false);
  if (!detailed || from.distanceTo(to) < 1e-6) return;
  const direction = to.clone().sub(from), rotation = along(from, to);
  const lateral = new Vector3(direction.z, 0, -direction.x).normalize().multiplyScalar(GANGWAY_WIDTH / 2);
  for (const side of [-1, 1]) {
    const middle = from.clone().lerp(to, .5).addScaledVector(lateral, side).add(new Vector3(0, RAIL_HEIGHT, 0));
    parts.add(middle, new Vector3(.04, .04, direction.length()), rotation);
    for (const end of [from, to]) parts.add(end.clone().addScaledVector(lateral, side)
      .add(new Vector3(0, RAIL_HEIGHT / 2, 0)), new Vector3(.04, RAIL_HEIGHT, .04));
  }
};
const contactOf = (work: ShipWorkpoint) => new Vector3(work.contact.x, work.y, work.contact.z);
/** The harbour pier a docked ship lies at: same shore and (within its mooring leeway) the same pier end. */
const matchingPier = (dock: ShipWorkpoint, piers: readonly ShipSiteFrame[]) => piers.find(pier => {
  const work = pier.workPier!;
  return work.shore.x === dock.shore.x && work.shore.z === dock.shore.z &&
    Math.hypot(work.point.x - dock.point.x, work.point.z - dock.point.z) < .3;
});

/**
 * Wooden piers: every finished harbour's permanent piers in one merged mesh, a gangway beside each docked
 * ship (or its whole pier where it lies away from a harbour pier), and the temporary construction ramps.
 */
export const createThreeShipWorkPiers = (material: MeshStandardMaterial, detailed: boolean) => {
  const group = new Group(); group.name = "ship_construction_piers";
  const box = new BoxGeometry(1, 1, 1), models = new Map<number, PierModel>();
  /** Troop gangways still running back in after their ship sailed. */
  let retracting: GangwayRun[] = [];
  let harbourPiers: { mesh: Mesh; sites: readonly ShipSiteFrame[] } | null = null;
  const buildMesh = (name: string, fill: (parts: Parts) => void) => {
    const geometries: BufferGeometry[] = [];
    fill({ add: (position, scale, quaternion = new Quaternion()) =>
      geometries.push(box.clone().applyMatrix4(new Matrix4().compose(position, quaternion, scale))) });
    const geometry = geometries.length ? mergeGeometries(geometries, false)! :
      new BufferGeometry().setAttribute("position", new Float32BufferAttribute([], 3));
    geometries.forEach(piece => piece.dispose());
    const mesh = new Mesh(geometry, material); mesh.name = name;
    mesh.castShadow = detailed; mesh.receiveShadow = true; group.add(mesh);
    return mesh;
  };
  const dispose = (mesh: Mesh) => { mesh.geometry.dispose(); mesh.removeFromParent(); };
  /** The fixed decks of all harbour piers, rebuilt only when the simulation hands out new pier frames. */
  const updateHarbourPiers = (piers: readonly ShipSiteFrame[]) => {
    const same = harbourPiers && harbourPiers.sites.length === piers.length &&
      harbourPiers.sites.every((site, index) => site === piers[index]);
    if (same) return;
    if (harbourPiers) dispose(harbourPiers.mesh);
    harbourPiers = null;
    if (!piers.length) return;
    const mesh = buildMesh("harbour_piers", parts => {
      for (const pier of piers) {
        const line = pierLine(pier.workPier!), jetty = pier.kind === "jetty";
        addPlanks(parts, line.start, jetty ? line.end : line.fixedEnd, jetty ? JETTY_WIDTH : DECK_WIDTH, detailed);
        addPosts(parts, line.start, jetty ? line.end : line.fixedEnd, pier.y, detailed);
        if (jetty) addNationalBoatJetty(parts, line.start, line.end, pier.nation ?? "roman", detailed);
      }
    });
    harbourPiers = { mesh, sites: piers };
  };
  /** A docked ship's gangway (from its harbour pier's end), or its whole pier where there is none. */
  const fillDock = (parts: Parts, site: ShipSiteFrame, piers: readonly ShipSiteFrame[]) => {
    const work = site.workPier!, own = pierLine(work), pier = matchingPier(work, piers);
    const from = pier ? pierLine(pier.workPier!).fixedEnd : own.fixedEnd;
    if (!pier) {
      addPlanks(parts, own.start, own.fixedEnd, DECK_WIDTH, detailed);
      addPosts(parts, own.start, own.fixedEnd, site.y, detailed);
    }
    addGangway(parts, from, own.end, contactOf(work), detailed);
  };
  /** A shipwright's temporary ramp from the shore to the ship under construction. */
  const fillRamp = (parts: Parts, site: ShipSiteFrame) => {
    const { end, start } = pierLine(site.workPier!);
    addPlanks(parts, start, end, DECK_WIDTH, detailed);
    addPosts(parts, start, end, site.y, detailed);
  };
  /** Runs the troop gangways out and back in (visual only; harbour docks and ramps appear at once). */
  const advanceRuns = (time: number) => {
    for (const model of models.values())
      if (model.run && advanceGangwayRun(model.run, time) === "out") model.run = undefined;
    retracting = retracting.filter(run => {
      if (advanceGangwayRun(run, time) !== "in") return true;
      dispose(run.mesh);
      return false;
    });
  };
  /** A removed model: a troop gangway runs back in first (its ship sailed), anything else goes at once. */
  const remove = (id: number, model: PierModel, time: number | undefined) => {
    if (time === undefined || !isTroopGangwaySite(id)) { dispose(model.mesh); return; }
    const run = model.run ?? startGangwayRun(model.mesh, model.work, time);
    retracting.push({ ...run, deployed: undefined, retracted: time });
  };
  /** A new or changed model; a newly anchored troop ship's gangway runs out from its hull. */
  const place = (site: ShipSiteFrame, piers: readonly ShipSiteFrame[], key: string, time: number | undefined) => {
    const work = site.workPier!, old = models.get(site.id);
    if (old) dispose(old.mesh);
    const mesh = buildMesh(`ship_work_pier_${site.id}`, parts =>
      site.kind === "dock" ? fillDock(parts, site, piers) : fillRamp(parts, site));
    const run = !old && time !== undefined && isTroopGangwaySite(site.id) ? startGangwayRun(mesh, work, time)
      : undefined;
    models.set(site.id, { key, mesh, run, work });
  };
  const update = (sites: readonly ShipSiteFrame[], time?: number) => {
    const piers = sites.filter(site => (site.kind === "pier" || site.kind === "jetty") && site.workPier);
    updateHarbourPiers(piers);
    const active = new Set<number>();
    for (const site of sites) {
      const work = site.workPier;
      if (!work || site.kind === "boat" || site.kind === "jetty" || site.kind === "pier") continue;
      active.add(site.id);
      const pier = site.kind === "dock" ? matchingPier(work, piers) : undefined;
      const key = JSON.stringify(work) + (pier ? JSON.stringify(pier.workPier) : "");
      if (models.get(site.id)?.key !== key) place(site, piers, key, time);
    }
    for (const [id, model] of models) if (!active.has(id)) { remove(id, model, time); models.delete(id); }
    if (time !== undefined) advanceRuns(time);
  };
  const disposeAll = () => {
    update([]);
    retracting.forEach(run => dispose(run.mesh));
    retracting = [];
    box.dispose();
    group.clear();
  };
  return { group, update, dispose: disposeAll };
};
