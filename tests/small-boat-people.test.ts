import { Group, Vector3 } from "three";
import { describe, expect, it, vi } from "vitest";

import type { ExplorationLoadedBody } from "../src/renderers/three/exploration/exploration-appearance";
import { createThreeHarbourShuttles } from "../src/renderers/three/settlement/three-harbour-shuttles";
import { createSmallBoatPeople } from "../src/renderers/three/settlement/three-small-boat-people";

describe("shared small boat population ownership", () => {
  it("leases only the visible single operator and releases a late lease without disposing the shared loader", async () => {
    const people = createSmallBoatPeople(false), release = vi.fn(), loaderDispose = vi.fn();
    let finish!: (body: ExplorationLoadedBody) => void;
    const load = vi.fn(() => new Promise<ExplorationLoadedBody>(resolve => { finish = resolve; }));
    people.setSource({ load, dispose: loaderDispose }, [{ nation: "roman", variant: "population-man" }]);
    const view = createThreeHarbourShuttles(false, people);
    view.update([{ boxes: 4, id: 1, laden: true, rowing: true, x: 0, y: 0, z: 0, yaw: 0 }], 1);
    expect(load).toHaveBeenCalledExactlyOnceWith({ nation: "roman", variant: "population-man" });
    expect(people.stats().boatPeople).toBe(1);
    view.dispose(); people.dispose();
    finish({ root: new Group(), clips: [], mixer: {} as ExplorationLoadedBody["mixer"], dispose: release });
    await people.whenReady();
    expect(release).toHaveBeenCalledOnce(); expect(loaderDispose).not.toHaveBeenCalled();
  });
  it("does not lease hidden passengers or shore-working crew", () => {
    const people = createSmallBoatPeople(false), load = vi.fn();
    people.setSource({ load, dispose: vi.fn() }, [{ nation: "roman", variant: "population-man" }]);
    const passenger = people.create(new Group(), "passenger");
    passenger.update({ visible: false, identity: 7, facing: 0, seat: new Vector3() });
    expect(load).not.toHaveBeenCalled(); people.dispose();
  });
});
