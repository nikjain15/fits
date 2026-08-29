/**
 * Browser stand-in for hash.ts. See that file for why the two differ.
 *
 * FNV-1a over two 32-bit halves. Not cryptographic and not meant to be: in the
 * browser this value is shown, never used as a key, and nothing downstream
 * depends on it matching the server's.
 */
export function hashText(s: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}
