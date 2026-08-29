/**
 * Bundle the engine for the browser.
 *
 * The one substitution: hash.ts -> hash.browser.ts. hash.ts uses node:crypto and
 * its value is part of every node key, so it is pinned and must not change; the
 * browser copy is display-only and never produces a key. See engine/src/hash.ts.
 */
import { build } from "esbuild";
import { resolve } from "node:path";

const swapNodeHash = {
  name: "swap-node-hash",
  setup(b) {
    b.onResolve({ filter: /(^|\/)hash\.ts$/ }, (args) => ({
      path: resolve(args.resolveDir, args.path.replace(/hash\.ts$/, "hash.browser.ts")),
    }));
  },
};

await build({
  entryPoints: ["engine/src/browser.ts"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: "web/engine.js",
  plugins: [swapNodeHash],
  logLevel: "warning",
});
console.log("bundled → web/engine.js");
