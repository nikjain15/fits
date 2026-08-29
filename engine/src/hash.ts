/**
 * The content hash used in node keys.
 *
 * PINNED ON PURPOSE. `skill_content` is part of every cell key, so changing this
 * function changes every key and re-runs the entire grid — not because any skill
 * moved, but because we edited a hash. Content addressing is meant to detect a
 * change in the SUBJECT; invalidating thousands of paid runs over an
 * implementation swap is it firing on us instead.
 *
 * The browser bundle aliases this module to hash.browser.ts, which cannot use
 * node:crypto. That copy is display-only and never produces a node key — the
 * browser does not write to the node store at all — so the two never have to
 * agree, and neither can silently invalidate the other's work.
 */
import { createHash } from "node:crypto";

export function hashText(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}
