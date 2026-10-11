// src/styles/__tests__/fonts.test.ts
// The site's fonts come from the site itself (T144). Loading them from Google
// handed every visitor's address to Google before any consent, and the
// privacy page did not say so. This holds the two halves of the fix: nothing
// in the page's head asks another host for a font, and every family the
// theme names is still declared, in each weight and style the design uses.

import * as fs from "fs";
import * as path from "path";
import { ROLE_MAP } from "core/themes/derive/role-map";

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (file: string): string => fs.readFileSync(file, "utf8");

/** Each `@import` in a stylesheet, resolved to a file under node_modules. */
const importedSheets = (css: string): string[] =>
  Array.from(css.matchAll(/@import\s+"([^"]+)"/g), ([, spec]) =>
    path.join(ROOT, "node_modules", spec)
  );

/** A declared face, as `family|weight|style`, from each `@font-face` block. */
const facesIn = (css: string): string[] =>
  Array.from(css.matchAll(/@font-face\s*{([^}]*)}/g), ([, body]) => {
    const family = body.match(/font-family:\s*'([^']+)'/)?.[1];
    const weight = body.match(/font-weight:\s*(\d+)/)?.[1];
    const style = body.match(/font-style:\s*(\w+)/)?.[1];
    return `${family}|${weight}|${style}`;
  });

/** The first family a theme font token names, without its quotes. */
const familyOf = (role: string): string => {
  const entry = ROLE_MAP[role] as { literal: string };
  return entry.literal.split(",")[0].replace(/'/g, "").trim();
};

describe("the site's fonts", () => {
  const html = read(path.join(ROOT, "index.html"));
  const fontsCss = read(path.join(ROOT, "src", "styles", "fonts.css"));
  const faces = importedSheets(fontsCss).flatMap((sheet) => facesIn(read(sheet)));

  it("asks no other host for them", () => {
    expect(html).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/);
    // Nor any other stylesheet or preconnect off the site: a font host by
    // another name would leak the same address.
    expect(html).not.toMatch(/<link[^>]+rel="(stylesheet|preconnect)"[^>]+href="https?:/);
  });

  it("is loaded by the app's entry", () => {
    expect(read(path.join(ROOT, "src", "index.tsx"))).toContain("import './styles/fonts.css';");
  });

  it.each([
    ["font.primary", ["400", "500", "600", "700"], "normal"],
    ["font.heading", ["400", "500", "600", "700"], "normal"],
    ["font.heading", ["400"], "italic"],
  ])("declares %s in weights %j, %s", (role, weights, style) => {
    const family = familyOf(role);
    for (const weight of weights) {
      expect(faces).toContain(`${family}|${weight}|${style}`);
    }
  });

  it("declares the rune's family for the Runic block only", () => {
    const runeCss = importedSheets(fontsCss)
      .map(read)
      .filter((css) => css.includes("'Noto Sans Runic'"))
      .join("\n");
    const files = Array.from(runeCss.matchAll(/url\(\.\/files\/([^)]+)\)/g), ([, f]) => f);
    // ᛗ is U+16D7, in the Runic block. No Latin face, so the mark's fallback
    // draws anything that is not a rune.
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(file).toMatch(/^noto-sans-runic-runic-400-normal\.woff2?$/);
    }
  });
});
