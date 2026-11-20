/** Bench-only scene measurements; never imported into the player runtime. */
export const readCatapultContacts = async () => {
  const host = window as any, scene = host.__catapultWorkerScene, review = host.__catapultReview;
  if (!scene) throw new Error("Native Three scene hook is missing");
  const { catapultCrewView } = await import(/* @vite-ignore */ String("/src/app/settlement/catapult-crew-view.ts"));
  const simulation = host.__settlement.simulation;
  const actor = simulation.frames().find((candidate: any) => candidate.uid === review.tower.catapultCycle.operator);
  const expected = catapultCrewView(actor, review.tower);
  const point = scene.position.clone();
  scene.updateMatrixWorld(true);
  const roots: { distance: number; node: any }[] = [];
  scene.traverse((node: any) => {
    if (node.type !== "Group" || !node.visible || !node.getObjectByName("socket_hand_L")) return;
    node.getWorldPosition(point);
    roots.push({ distance: Math.hypot(point.x - expected.x, point.y - expected.y, point.z - expected.z), node });
  });
  roots.sort((a, b) => a.distance - b.distance);
  const root = roots[0]?.node;
  if (!root || roots[0]!.distance > .1) {
    const rigs: unknown[] = [];
    scene.traverse((node: any) => {
      if (!["LeftHand", "socket_hand_L", "hand_L"].includes(node.name)) return;
      rigs.push({ name: node.name, world: node.getWorldPosition(point).toArray(),
        parents: [node.parent?.name, node.parent?.parent?.name, node.parent?.parent?.parent?.name] });
    });
    return { error: "Rooftop operator native model not found", expected,
      roots: roots.slice(0, 5).map(({ distance, node }) => ({ distance, name: node.name,
        position: node.getWorldPosition(point).toArray() })), rigs };
  }
  const positions = (names: readonly string[]) => names.map(name => {
    const node = root.getObjectByName(name);
    return node?.getWorldPosition(point).toArray() as number[] | undefined;
  });
  const palms = positions(["socket_hand_L", "socket_hand_R"]);
  const joints = positions(["LeftArm", "LeftForeArm", "LeftHand", "RightArm", "RightForeArm", "RightHand"]);
  const hands = expected.catapultOperator?.hands;
  const crankErrors = hands?.map((target: readonly number[], index: number) =>
    palms[index] ? Math.hypot(...target.map((value, axis) => value - palms[index]![axis]!)) : null);
  const isVisible = (node: any): boolean => !node || (node.visible && isVisible(node.parent));
  let held: any;
  root.traverse((node: any) => { if (node.name === "ware_geometry" && isVisible(node)) held = node.parent; });
  const supports = [held?.userData.stoneSupportLeft, held?.userData.stoneSupportRight] as (number[] | undefined)[];
  const carryErrors = supports.map((target, index) => target && palms[index]
    ? Math.hypot(...target.map((value, axis) => value - palms[index]![axis]!)) : null);
  const soles = { Left: Infinity, Right: Infinity };
  root.traverse((mesh: any) => {
    if (!mesh.isSkinnedMesh || !isVisible(mesh)) return;
    const indices = mesh.geometry.getAttribute("skinIndex"), weights = mesh.geometry.getAttribute("skinWeight");
    if (!indices || !weights) return;
    for (let vertex = 0; vertex < indices.count; vertex++) {
      for (const side of ["Left", "Right"] as const) {
        let share = 0;
        for (let slot = 0; slot < 4; slot++) {
          const joint = [indices.getX(vertex), indices.getY(vertex), indices.getZ(vertex), indices.getW(vertex)][slot]!;
          const bone = mesh.skeleton.bones[joint]?.name ?? "";
          if (!bone.includes(`${side}Foot`) && !bone.includes(`${side}Toe`)) continue;
          share += [weights.getX(vertex), weights.getY(vertex), weights.getZ(vertex), weights.getW(vertex)][slot]!;
        }
        if (share < .6) continue;
        mesh.getVertexPosition(vertex, point); mesh.localToWorld(point);
        soles[side] = Math.min(soles[side], point.y);
      }
    }
  });
  return { carryErrors, crankErrors, expectedFloor: expected.y, joints, targets: hands, palms,
    soles: { left: soles.Left - expected.y, right: soles.Right - expected.y }, supports };
};
