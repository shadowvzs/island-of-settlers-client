/** Bytes per String.fromCharCode call (stays under the engine argument limits). */
const BASE64_CHUNK = 0x8000;

export const bytesToBase64 = (bytes: Uint8Array) => {
  let text = "";
  for (let start = 0; start < bytes.length; start += BASE64_CHUNK)
    text += String.fromCharCode(...bytes.subarray(start, start + BASE64_CHUNK));
  return btoa(text);
};

export const base64ToBytes = (text: string) => {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
};
