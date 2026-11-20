import { DMath } from "../math/deterministic-math";
import { addGood } from "./production-rules";
import type { FoundingOperation } from "./settlement-naval-founding";
import type { NavalShip } from "./settlement-naval-fleet";
import { groundPath, moveActor, setActorPath } from "./settlement-paths";
import { advanceShipPier } from "./settlement-ship-workpoint";
import type { SettlementBuilding, SettlementContext } from "./settlement-types";

export const createFoundingCarrier = (context: SettlementContext, options: {
  missingMaterial(site: SettlementBuilding): string | undefined;
  setBlocked(operation: FoundingOperation, reason: string): void;
  shipOf(operation: FoundingOperation): NavalShip | undefined;
  withdrawFoundingCargo(id: number, ware: string, count: number): number;
}) => {
  const { missingMaterial, setBlocked, shipOf, withdrawFoundingCargo } = options;
  const actorOf = (uid: number) => context.actors.find(actor => actor.uid === uid);
  const deposit = (operation: FoundingOperation, site: SettlementBuilding) => {
    const carrier = actorOf(operation.carrier);
    if (!carrier?.ware) return;
    const destination = site.construction >= 1 ? site.inventory : site.input;
    addGood(destination, carrier.ware, carrier.wareUnits ?? 1);
    carrier.ware = null; carrier.wareUnits = undefined; carrier.wareScale = undefined;
    carrier.action = "idle";
    operation.stage = site.construction >= 1 ? "unloading" : operation.stage;
  };
  const beginCarry = (operation: FoundingOperation, site: SettlementBuilding) => {
    const carrier = actorOf(operation.carrier);
    const ship = shipOf(operation);
    if (!carrier || !ship) { setBlocked(operation, "carrier or ship missing"); return false; }
    const ware = site.construction >= 1
      ? Object.keys(ship.cargo).find(name => (ship.cargo[name] ?? 0) > 0)
      : missingMaterial(site);
    if (!ware) return false;
    if ((ship.cargo[ware] ?? 0) < 1) {
      setBlocked(operation, `missing ${ware}`);
      return false;
    }
    if (operation.landing && carrier.phase !== "foundingCargoOut") {
      if (DMath.hypot(carrier.x - operation.shore.x, carrier.z - operation.shore.z) > .05) {
        sendCarrierBack(operation, site);
      } else { carrier.phase = "foundingCargoOut"; carrier.action = "walk"; }
      return true;
    }
    if (!withdrawFoundingCargo(operation.shipId, ware, 1)) return false;
    carrier.ware = ware;
    carrier.phase = "foundingCarry"; carrier.action = "carry";
    if (operation.landing) { carrier.phase = "foundingCargoBack"; return true; }
    const path = groundPath(context, carrier, site.access, site.uid);
    if (!path) { setBlocked(operation, "no carrier route to the site"); return false; }
    setActorPath(carrier, path, "foundingCarry");
    carrier.action = "carry";
    return true;
  };
  const sendCarrierBack = (operation: FoundingOperation, site: SettlementBuilding) => {
    const carrier = actorOf(operation.carrier);
    if (!carrier) return;
    const path = groundPath(context, carrier, operation.shore, site.uid);
    if (!path) { carrier.phase = "foundingWait"; return; }
    setActorPath(carrier, path, "foundingReturn");
  };
  const updateCarrier = (operation: FoundingOperation, site: SettlementBuilding, dt: number) => {
    const carrier = actorOf(operation.carrier);
    const ship = shipOf(operation);
    if (!carrier || !ship) { setBlocked(operation, "carrier or ship missing"); return; }
    if (carrier.phase === "foundingCargoOut" && operation.landing) {
      if (advanceShipPier(context, carrier, operation.landing.pier, false, dt)) beginCarry(operation, site);
      return;
    }
    if (carrier.phase === "foundingCargoBack" && operation.landing) {
      if (!advanceShipPier(context, carrier, operation.landing.pier, true, dt)) return;
      const path = groundPath(context, carrier, site.access, site.uid);
      if (path) setActorPath(carrier, path, "foundingCarry");
      else setBlocked(operation, "no carrier route to the site");
      return;
    }
    if (carrier.phase === "foundingCarry") {
      if (carrier.ware) {
        if (carrier.pathIndex >= carrier.path.length) deposit(operation, site);
        else moveActor(context, carrier, dt);
      }
      if (!carrier.ware) sendCarrierBack(operation, site);
      return;
    }
    if (carrier.phase === "foundingReturn") {
      if (carrier.pathIndex < carrier.path.length) { moveActor(context, carrier, dt); return; }
      carrier.phase = "foundingWait"; carrier.action = "idle";
    }
    if (site.construction >= 1) return;
    if (missingMaterial(site)) beginCarry(operation, site);
  };
  return { beginCarry, updateCarrier };
};
