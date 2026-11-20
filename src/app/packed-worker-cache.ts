type NumericView = Exclude<ArrayBufferView, DataView> & { length: number };
export interface PackedWorkerValue { bytes: ArrayBuffer; shape: string }
const constructors = {
  Float32Array, Float64Array, Int8Array, Int16Array, Int32Array,
  Uint8Array, Uint8ClampedArray, Uint16Array, Uint32Array
};
type ViewName = keyof typeof constructors;

/** One aligned byte buffer and a small JSON shape instead of hundreds of cloned view objects. */
export const packWorkerValue = (value: unknown): PackedWorkerValue => {
  const parts: { bytes: Uint8Array; offset: number }[] = [];
  const buffers = new Map<ArrayBufferLike, number>();
  let length = 0;
  const shape = JSON.stringify(value, (_key, item) => {
    if (!ArrayBuffer.isView(item)) return item;
    const view = item as NumericView;
    let offset = buffers.get(view.buffer);
    if (offset === undefined) {
      offset = Math.ceil(length / 8) * 8;
      const bytes = new Uint8Array(view.buffer);
      parts.push({ bytes, offset }); buffers.set(view.buffer, offset);
      length = offset + bytes.byteLength;
    }
    return { $view: [view.constructor.name, offset + view.byteOffset, view.length] };
  });
  const bytes = new Uint8Array(length);
  for (const part of parts) bytes.set(part.bytes, part.offset);
  return { bytes: bytes.buffer, shape };
};

// Callers supply the decoded value type at this serialized worker boundary.
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters
export const unpackWorkerValue = <T>({ bytes, shape }: PackedWorkerValue): T =>
  JSON.parse(shape, (_key, item) => {
    if (!item?.$view) return item;
    const [name, offset, length] = item.$view as [ViewName, number, number];
    return new constructors[name](bytes, offset, length);
  }) as T;
