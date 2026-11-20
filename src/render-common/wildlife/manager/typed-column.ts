const COLUMN_TYPES = {
  f32: Float32Array,
  i16: Int16Array,
  i32: Int32Array,
  u16: Uint16Array,
  u32: Uint32Array,
  u8: Uint8Array
} as const;

export type ColumnType = keyof typeof COLUMN_TYPES;
export type ColumnConstructor = (typeof COLUMN_TYPES)[ColumnType];
export type ColumnArray = InstanceType<ColumnConstructor>;

/** A typed array saved as its exact little-endian bytes (base64): no JSON number rounding. */
export interface TypedColumn {
  bytes: string;
  length: number;
  type: ColumnType;
}

if (new Uint8Array(new Uint16Array([1]).buffer)[0] !== 1) {
  throw new Error("Wildlife save columns need a little-endian host");
}

const columnTypeOf = (view: ArrayBufferView): ColumnType => {
  for (const [name, constructor] of Object.entries(COLUMN_TYPES)) {
    if (view instanceof constructor) return name as ColumnType;
  }
  throw new Error("Unsupported wildlife column array");
};

const bytesToBase64 = (bytes: Uint8Array) => {
  let text = "";
  for (let start = 0; start < bytes.length; start += 8192) {
    text += String.fromCharCode(...bytes.subarray(start, start + 8192));
  }
  return btoa(text);
};

const base64ToBytes = (text: string) => {
  const decoded = atob(text);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
  return bytes;
};

export const encodeTypedColumn = (view: ColumnArray): TypedColumn => ({
  bytes: bytesToBase64(new Uint8Array(view.buffer, view.byteOffset, view.byteLength)),
  length: view.length,
  type: columnTypeOf(view)
});

const isColumn = (value: unknown): value is TypedColumn => {
  if (!value || typeof value !== "object") return false;
  const column = value as Partial<TypedColumn>;
  return typeof column.bytes === "string" && Number.isSafeInteger(column.length) &&
    column.length! >= 0 && typeof column.type === "string" && column.type in COLUMN_TYPES;
};

/**
 * The typed array of a saved column of `constructor`'s type (`expectedLength` when known); throws
 * on any shape, type or byte length mismatch. Values are the caller's to validate.
 */
export const decodeTypedColumn = <Constructor extends ColumnConstructor>(
  saved: unknown,
  constructor: Constructor,
  expectedLength?: number
): InstanceType<Constructor> => {
  if (!isColumn(saved) || COLUMN_TYPES[saved.type] !== constructor) {
    throw new Error("Invalid wildlife column");
  }
  if (expectedLength !== undefined && saved.length !== expectedLength) {
    throw new Error("Invalid wildlife column length");
  }
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(saved.bytes);
  } catch {
    throw new Error("Invalid wildlife column bytes");
  }
  if (bytes.length !== saved.length * constructor.BYTES_PER_ELEMENT) {
    throw new Error("Invalid wildlife column bytes");
  }
  const view = new constructor(saved.length) as InstanceType<Constructor>;
  new Uint8Array(view.buffer).set(bytes);
  return view;
};
