/** JSON-only repair for the exact two legacy Well35 channels omitted by visible-only export. */
export const repairRetainedWellAnimationChannels = (bytes: Uint8Array, nation: string) => {
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (header.getUint32(0, true) !== 0x46546c67 || header.getUint32(4, true) !== 2 ||
    header.getUint32(8, true) !== bytes.length || header.getUint32(16, true) !== 0x4e4f534a)
    throw new Error("Expected a complete binary glTF2 JSON-first asset");
  const length = header.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length)));
  const changes: { clip: string; channel: number }[] = [];
  const pending: { target: { node?: number }; clip: string; channel: number }[] = [];
  for (const clip of json.animations ?? []) for (const [index, channel] of clip.channels.entries()) {
    if (Number.isInteger(channel.target.node) && json.nodes[channel.target.node]) continue;
    const construction = clip.name === `${nation}_35_construction` && index === 5 && channel.target.path === "scale";
    const door = clip.name === `${nation}_35_door` && index === 0 && channel.target.path === "rotation";
    const accessor = json.accessors[clip.samplers[channel.sampler].output];
    if (channel.target.node !== undefined || !((construction && accessor.type === "VEC3") ||
      (door && accessor.type === "VEC4"))) throw new Error(`Unexpected unbound channel: ${clip.name}/${index}`);
    pending.push({ target: channel.target, clip: clip.name, channel: index });
  }
  if (!pending.length) return { bytes, repaired: 0, changes };
  if (pending.length !== 2) throw new Error("Expected exactly the known Well construction/door channel pair");
  const root = json.nodes.find((node: { name?: string; extras?: { buildingId?: number; nation?: string } }) =>
    node.name === `${nation}_35` && node.extras?.buildingId === 35 && node.extras?.nation === nation);
  if (!root) throw new Error("Missing canonical Well35 model root");
  const anchor = json.nodes.length;
  json.nodes.push({ name: `${nation}_35_hidden_door_anchor`, extras: { exportHiddenDoorAnchor: true } });
  root.children = [...root.children ?? [], anchor];
  for (const row of pending) { row.target.node = anchor; changes.push({ clip: row.clip, channel: row.channel }); }
  const encoded = new TextEncoder().encode(JSON.stringify(json)), padded = Math.ceil(encoded.length / 4) * 4;
  const tail = bytes.subarray(20 + length), repaired = new Uint8Array(20 + padded + tail.length);
  repaired.set(bytes.subarray(0, 20)); repaired.fill(32, 20, 20 + padded); repaired.set(encoded, 20);
  repaired.set(tail, 20 + padded);
  const view = new DataView(repaired.buffer); view.setUint32(8, repaired.length, true); view.setUint32(12, padded, true);
  return { bytes: repaired, repaired: pending.length, changes };
};
