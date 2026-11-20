const WORD_BYTES = 4;

/** Whole 4-byte words of a byte mask whose bytes start 4-aligned, else null. */
const wordsOf = (mask: Uint8Array) => mask.byteOffset % WORD_BYTES === 0
  ? new Uint32Array(mask.buffer, mask.byteOffset, Math.floor(mask.length / WORD_BYTES)) : null;

/** True when two byte masks hold the same bytes (compared four at a time where aligned). */
export const sameMaskBytes = (first: Uint8Array, second: Uint8Array) => {
  if (first.length !== second.length) return false;
  const firstWords = wordsOf(first), secondWords = wordsOf(second);
  let from = 0;
  if (firstWords && secondWords) {
    for (let word = 0; word < firstWords.length; word++) if (firstWords[word] !== secondWords[word]) return false;
    from = firstWords.length * WORD_BYTES;
  }
  for (let index = from; index < first.length; index++) if (first[index] !== second[index]) return false;
  return true;
};
