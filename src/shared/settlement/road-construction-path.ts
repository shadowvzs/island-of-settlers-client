import { findRoadPath } from "./road-pathfinding";
import type { createRoadTraversal } from "./road-traversal";
import { ROAD_GRID_STEP, type RoadPoint } from "./road-types";

type Traversal = ReturnType<typeof createRoadTraversal>;
const CONSTRUCTION_STEPS: ReadonlyArray<readonly [number, number]> = [[0.5, 0], [0, 0.5], [-0.5, 0], [0, -0.5]];
const STEP_COUNT = CONSTRUCTION_STEPS.length;
/** Expansions a search runs before it starts proving that its end is enclosed (short plans never pay for it). */
const ENCLOSURE_PROOF_AFTER = 256;
/**
 * The start's flood advances on every fourth expansion only: the A* already explores forwards (four arrival states
 * per node), so this still closes an enclosed start well before the A* would, at a quarter of the extra steps.
 */
const START_PROOF_EVERY = 4;

/**
 * `walkable` of each step from a node, asked once per search: the A* reaches a node once per arrival direction and
 * the enclosure proof asks the same steps backwards. Nothing changes the world while a plan is searched.
 */
const createStepMemo = (traversal: Traversal) => {
  const known = new Map<number, boolean>();
  return (node: number, direction: number) => {
    const key = node * STEP_COUNT + direction;
    let open = known.get(key);
    if (open !== undefined) return open;
    const position = traversal.point(node), [dx, dz] = CONSTRUCTION_STEPS[direction]!;
    open = traversal.walkable(position, { x: position.x + dx, z: position.z + dz });
    known.set(key, open);
    return open;
  };
};

/**
 * A flood over whole nodes, one node per call: from `last` backwards over the steps that lead into it, or from
 * `first` forwards over its steps. True once the flood closed without meeting the other end, which proves that no
 * plan exists (a plan's every step stays inside both floods). Once it meets the other end a plan may exist, and
 * the flood stops.
 */
const createFloodProof = (traversal: Traversal, step: (node: number, direction: number) => boolean,
  origin: number, target: number, backward: boolean) => {
  const queue = [origin], seen = new Set(queue);
  const sign = backward ? -1 : 1;
  let head = 0, met = false;
  const spread = (current: number, position: RoadPoint, direction: number) => {
    const [dx, dz] = CONSTRUCTION_STEPS[direction]!, other = { x: position.x + dx * sign, z: position.z + dz * sign };
    if (!traversal.validPoint(other)) return;
    const node = traversal.node(other);
    if (seen.has(node) || !step(backward ? node : current, direction)) return;
    met ||= node === target;
    seen.add(node);
    queue.push(node);
  };
  return () => {
    if (met) return false;
    if (head < queue.length) {
      const current = queue[head++]!, position = traversal.point(current);
      for (let direction = 0; direction < STEP_COUNT && !met; direction++) spread(current, position, direction);
    }
    return !met && head === queue.length;
  };
};

/** Track arrival direction so equally short routes favor long runs rather than sawtooth turns. */
export const findRoadConstructionPath = (first: number, last: number, traversal: Traversal) => {
  const { node, point } = traversal;
  const destination = point(last), step = createStepMemo(traversal);
  const endEnclosed = createFloodProof(traversal, step, last, first, true);
  const startEnclosed = createFloodProof(traversal, step, first, last, false);
  let expansions = 0;
  const result = findRoadPath(first * 5 + 4, last * 5 + 4, (state, visit) => {
    const current = Math.floor(state / 5), direction = state % 5;
    if (current === last) {
      visit(last * 5 + 4, 0);
      return;
    }
    const position = point(current);
    for (let nextDirection = 0; nextDirection < STEP_COUNT; nextDirection++) {
      if (!step(current, nextDirection)) continue;
      const [dx, dz] = CONSTRUCTION_STEPS[nextDirection]!;
      const turn = direction === 4 || direction === nextDirection ? 0 : 0.04;
      visit(node({ x: position.x + dx, z: position.z + dz }) * 5 + nextDirection, ROAD_GRID_STEP + turn);
    }
  }, (state) => {
    const current = point(Math.floor(state / 5));
    return Math.abs(current.x - destination.x) + Math.abs(current.z - destination.z);
  }, undefined, () => ++expansions > ENCLOSURE_PROOF_AFTER &&
    (endEnclosed() || (expansions % START_PROOF_EVERY === 0 && startEnclosed())));
  if (result.status !== "found") return null;
  const path = result.path.map((state) => Math.floor(state / 5))
    .filter((current, index, nodes) => index === 0 || current !== nodes[index - 1]);
  return { cost: result.cost, path };
};
