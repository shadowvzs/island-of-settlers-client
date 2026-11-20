import { expect, it } from "vitest";

import { setActorPath } from "../src/shared/settlement/settlement-paths";
import { refreshRoadTravel } from "../src/shared/settlement/settlement-road-rerouting";
import { addRoadWalker, createTrafficWorld } from "./helpers/traffic-scenario";

const fixture = () => {
  const scene = createTrafficWorld(20);
  scene.roads.addRoad({ x: 4, z: 4 }, { x: 12, z: 4 });
  const actor = addRoadWalker(scene, {
    job: "Carrier", phase: "pickup", to: { x: 8, z: 4 }, uid: 1, x: 4, z: 4
  });
  expect(refreshRoadTravel(scene.context, actor)).toBe(true);
  return { actor, ...scene };
};

it.each([
  { graphChanged: false, pathChanged: false },
  { graphChanged: false, pathChanged: true },
  { graphChanged: true, pathChanged: false },
  { graphChanged: true, pathChanged: true }
])("keeps the current destination when path=$pathChanged and graph=$graphChanged change", ({ graphChanged, pathChanged }) => {
  const { actor, context, roads, routeCalls } = fixture();
  const target = { x: pathChanged ? 12 : 8, z: 4 };
  if (pathChanged) setActorPath(actor, roads.route(actor, target)!.points, "pickup");
  if (graphChanged) roads.addRoad({ x: 4, z: 4 }, { x: 4, z: 5 });
  const calls = routeCalls();
  const position = { x: actor.x, z: actor.z };

  expect(refreshRoadTravel(context, actor)).toBe(true);
  expect(actor.path.at(-1)).toEqual(target);
  expect(routeCalls() - calls).toBe(Number(graphChanged));
  expect({ x: actor.x, z: actor.z }).toEqual(position);
  expect(actor.phase).toBe("pickup");
});

it("still stops a replaced journey when its new destination was disconnected, then resumes that destination", () => {
  const { actor, context, roads } = fixture();
  const target = { x: 12, z: 4 };
  setActorPath(actor, roads.route(actor, target)!.points, "pickup");
  expect(roads.removeRoad({ x: 11.5, z: 4 }, target)).toBe(true);

  expect(refreshRoadTravel(context, actor)).toBe(false);
  expect(actor.path.at(-1)).toEqual(target);
  expect(actor.action).toBe("idle");
  expect(actor.x).toBe(4);
  expect(actor.z).toBe(4);

  roads.addRoad({ x: 11.5, z: 4 }, target);
  expect(refreshRoadTravel(context, actor)).toBe(true);
  expect(actor.path.at(-1)).toEqual(target);
});

it("allows a new reachable assignment to replace a blocked route without another graph edit", () => {
  const { actor, context, roads } = fixture();
  roads.removeRoad({ x: 7.5, z: 4 }, { x: 8, z: 4 });
  expect(refreshRoadTravel(context, actor)).toBe(false);
  const target = { x: 6, z: 4 };
  setActorPath(actor, roads.route(actor, target)!.points, "pickup");

  expect(refreshRoadTravel(context, actor)).toBe(true);
  expect(actor.path.at(-1)).toEqual(target);
});
