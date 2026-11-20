import { cartLoadVariant } from "../../render-common/logistics/cart-cargo-heap";
import type { HandcartFrame } from "../../render-common/logistics/handcart-frame";
import { cartHitchPoint, HANDCART } from "../../render-common/logistics/handcart-rules";
import type { WorkerFrame } from "../../render-common/workers/worker-unit";
import type {
  AbandonedHandcart, SettlementActor, SettlementHandcart
} from "../../shared/settlement/settlement-types";
import { sampleSmooth } from "../../shared/world/grid-geometry";
import type { WorldData } from "../../shared/world/world-data";
import { type CartPuller, type CartTrack, createCartTrack, createTrackBehind, followPuller } from "./handcart-track";

/** A larger jump between two frames is a placement (load, recovery), not a roll of the wheels. */
const SNAP_DISTANCE = 2;

interface CartLoad { count: number; ware: string | null }

const loadOf = (cart: SettlementHandcart): CartLoad =>
  ({ count: cart.trip ? cart.cargo : 0, ware: cart.trip?.ware ?? null });

interface DrawnCart {
  frame: HandcartFrame;
  track: CartTrack;
}

/**
 * Draw frames of the hand carts outside their sheds: parked ones where they stand, pulled ones
 * following their puller (handcart-track.ts). The puller's worker frame gets the cart pose, so
 * his hands grip its shafts.
 */
export const createHandcartRenderFrames = (world: WorldData, handcartBonus: () => number = () => 0) => {
  const carts = new Map<number, DrawnCart>();
  const frames: HandcartFrame[] = [];
  const cartActors = new Map<number, SettlementActor>();
  const drawn = new Set<number>();
  const groundAt = (x: number, z: number) => sampleSmooth(world, world.heights, x, z);

  const entry = (uid: number, start: () => CartTrack) => {
    let cart = carts.get(uid);
    if (!cart) {
      cart = { frame: { count: 0, id: uid, load: "base", pitch: 0, ware: null, wheelAngle: 0, x: 0, y: 0, yaw: 0,
        z: 0 },
        track: start() };
      Object.assign(cart.frame, { x: cart.track.x, yaw: cart.track.yaw, z: cart.track.z });
      carts.set(uid, cart);
    }
    return cart;
  };
  /** The drawn load variant follows the handcart talent; it is chosen only when the load changes. */
  const setLoad = (frame: HandcartFrame, ware: string | null, count: number) => {
    if (frame.ware === ware && frame.count === count) return;
    frame.ware = ware; frame.count = count;
    frame.load = cartLoadVariant(ware, count, handcartBonus());
  };
  /** Copies the track into the frame: wheels roll by the distance moved, the front rises to `frontY`. */
  const publish = ({ frame, track }: DrawnCart, load: CartLoad, frontY: number) => {
    const rolled = Math.hypot(track.x - frame.x, track.z - frame.z);
    if (rolled < SNAP_DISTANCE) frame.wheelAngle = (frame.wheelAngle + rolled / HANDCART.wheelRadius) % (Math.PI * 2);
    frame.x = track.x; frame.z = track.z; frame.yaw = track.yaw;
    frame.y = groundAt(track.x, track.z);
    frame.pitch = Math.atan2(frontY - frame.y, HANDCART.carrierOffset);
    setLoad(frame, load.ware, load.count);
    frames.push(frame);
    drawn.add(frame.id);
    return frame;
  };
  const pulled = (actor: SettlementActor, puller: CartPuller & { y: number }, dt: number) => {
    const cart = entry(actor.uid, () => createTrackBehind(puller));
    const moved = Math.hypot(puller.x - cart.track.trail.at(-1)!.x, puller.z - cart.track.trail.at(-1)!.z) > 1e-3;
    followPuller(cart.track, puller, moved, dt);
    return publish(cart, loadOf(actor.handcart!), puller.y);
  };
  const parked = (id: number, stand: NonNullable<SettlementHandcart["parked"]>, load: CartLoad) => {
    const cart = entry(id, () => createCartTrack(stand.x, stand.z, stand.yaw));
    Object.assign(cart.track, createCartTrack(stand.x, stand.z, stand.yaw));
    const hitch = cartHitchPoint(stand.x, stand.z, stand.yaw);
    publish(cart, load, groundAt(hitch.x, hitch.z));
  };

  /** Call after the worker frames of this render frame were updated. */
  const update = (actors: readonly SettlementActor[], workers: readonly WorkerFrame[], dt: number,
    abandoned: readonly AbandonedHandcart[] = []) => {
    frames.length = 0;
    cartActors.clear();
    drawn.clear();
    for (const actor of actors)
      if (actor.handcart && actor.handcart.state !== "stored") cartActors.set(actor.uid, actor);
    for (const worker of workers) {
      const actor = worker.actorId === undefined ? undefined : cartActors.get(worker.actorId);
      worker.handcart = undefined;
      if (actor?.handcart!.state !== "hitched") continue;
      worker.handcart = pulled(actor, worker, dt);
      cartActors.delete(actor.uid);
    }
    // Parked carts, and pulled ones whose puller is not drawn this frame.
    for (const actor of cartActors.values()) {
      const stand = actor.handcart!.parked;
      if (actor.handcart!.state === "parked" && stand) parked(actor.uid, stand, loadOf(actor.handcart!));
      else pulled(actor, { heading: actor.yaw, x: actor.x, y: actor.y, z: actor.z }, dt);
    }
    // Carts that lost their crew stand where they stopped (keyed by the lost puller's uid).
    for (const cart of abandoned) parked(cart.id, cart, { count: cart.cargo ?? 0, ware: cart.ware ?? null });
    // The cart is shelved when its puller reaches the entrance, but the carrier still walks in.
    // Keep the last cart frame while that puller is drawn, so it does not vanish at the doorway.
    const visible = new Set(workers.flatMap(worker => worker.actorId === undefined ? [] : [worker.actorId]));
    for (const [uid, cart] of carts) {
      if (drawn.has(uid)) continue;
      if (!visible.has(uid)) { carts.delete(uid); continue; }
      frames.push(cart.frame);
    }
    return frames;
  };
  /** The carts drawn by the last `update` (traffic-wear wheel ruts read their axle centres). */
  return { current: (): readonly HandcartFrame[] => frames, update };
};
