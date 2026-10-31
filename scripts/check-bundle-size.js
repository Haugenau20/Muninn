#!/usr/bin/env node
// scripts/check-bundle-size.js
//
// Fails when the entry bundle outgrows its ceiling (T030). Run after
// `npm run build`: `npm run check:bundle`.
//
// Only the entry -- what `build/index.html` loads -- has a ceiling. It is what
// every visit downloads and parses before anything renders; a route chunk
// costs only the visits to that route, and is fetched at idle besides
// (`prefetchPages` in `app/lazyPage.ts`).
//
// Sizes are gzipped at level 9 and reported in base-10 kB.
//
// RAISING THE CEILING is allowed, and is a decision: say in the PR what grew
// and why it has to be in the entry bundle rather than in a route's chunk.
// The usual cause is an eager module (a provider, the layout, a feature
// barrel's public API) importing something only one page needs.

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

/**
 * Measured 2026-10-06: 260.81 kB in one file on Vite 7, 262.96 kB in 24 files on
 * Vite 8, whose Rolldown splits shared code out of the entry (CRA's main.js was
 * 264.23 kB). ~3% headroom.
 *
 * Raised 2026-10-08 (T130): 270.90 kB on main, 291.72 kB with Firestore's
 * persistent cache. The ~21 kB is the SDK's IndexedDB layer. It cannot be a
 * lazy chunk: `@firebase/firestore` is one module, so the cache code is either
 * in the bundle or tree-shaken out, and the cache must be chosen before
 * Firestore's first read. It buys a reload that is billed for what changed
 * rather than for every document again. ~3% headroom.
 *
 * Raised 2026-10-31 (T163): 293.47 kB on main, 296.50 kB with "already
 * exists" (quick add and the notes provider are eager), 300.87 kB with
 * private records, whose list merge and write routing live in the four
 * record providers every page mounts. Loading the rare pieces on demand (the
 * move of a private record whose id was taken, the "already exists" dialog)
 * made the entry larger, not smaller: what they share became chunks of their
 * own, preloaded with it. ~3% headroom.
 */
const MAIN_CEILING_KB = 310;

const buildDir = path.resolve(__dirname, "..", "build");

/** Gzipped size in kB (level 9, base 10). */
function gzipKb(file) {
  return zlib.gzipSync(fs.readFileSync(file), { level: 9 }).length / 1000;
}

const htmlFile = path.join(buildDir, "index.html");
if (!fs.existsSync(htmlFile)) {
  console.error(`No build at ${buildDir}. Run \`npm run build\` first.`);
  process.exit(2);
}

// The entry is everything index.html makes a visit download before anything
// renders: its module script, and every chunk it modulepreloads. Rolldown
// splits code shared with the route chunks out of the entry file, which alone
// would undercount.
const html = fs.readFileSync(htmlFile, "utf8");
const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="\/([^"]+\.js)"/g)].map((match) => match[1]);
const preloads = [...html.matchAll(/<link\b[^>]*\brel="modulepreload"[^>]*\bhref="\/([^"]+\.js)"/g)].map(
  (match) => match[1]
);
if (scripts.length === 0) {
  console.error(`No module script in ${htmlFile}; is this a Vite build?`);
  process.exit(2);
}
const entryFiles = [...scripts, ...preloads];

const mainKb = entryFiles.reduce((sum, file) => sum + gzipKb(path.join(buildDir, file)), 0);
const assetsDir = path.join(buildDir, "assets");
const chunks = fs
  .readdirSync(assetsDir)
  .filter((name) => name.endsWith(".js") && !entryFiles.includes(`assets/${name}`))
  .map((name) => ({ name, kb: gzipKb(path.join(assetsDir, name)) }))
  .sort((a, b) => b.kb - a.kb);

console.log(`entry     ${mainKb.toFixed(2)} kB gzip in ${entryFiles.length} file(s) (ceiling ${MAIN_CEILING_KB} kB)`);
console.log(`chunks    ${chunks.length}, largest ${chunks.slice(0, 3).map((c) => `${c.name} ${c.kb.toFixed(2)} kB`).join(", ")}`);

if (mainKb > MAIN_CEILING_KB) {
  console.error(
    `\nThe entry is ${(mainKb - MAIN_CEILING_KB).toFixed(2)} kB over its ceiling.\n` +
      "Something that only a page needs is probably being imported from an eager module.\n" +
      "Compare `npx source-map-explorer build/assets/index-*.js` against main, or raise\n" +
      "MAIN_CEILING_KB in scripts/check-bundle-size.js and say why in the PR."
  );
  process.exit(1);
}
