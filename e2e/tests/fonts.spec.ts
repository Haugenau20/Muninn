// e2e/tests/fonts.spec.ts
import { test, expect } from "../support/test";
import { E2E } from "../support/env";

// Someone who has never visited, so nothing has been agreed to.
test.use({ storageState: { cookies: [], origins: [] } });

/**
 * T144: every page loaded its fonts from fonts.googleapis.com, so each visit
 * handed the visitor's address to Google before anyone had been asked. The
 * fonts now come from the site itself. The fixture aborts requests to other
 * hosts, which hid the old ones: the page still drew, in fallback faces. So
 * this records every request the page *tries*, and checks the faces drawn.
 */
test("the fonts come from the site itself, before anything is agreed to", async ({ page }) => {
  const elsewhere: string[] = [];
  page.on("request", (request) => {
    const type = request.resourceType();
    if ((type === "font" || type === "stylesheet") && new URL(request.url()).hostname !== E2E.host) {
      elsewhere.push(request.url());
    }
  });

  // The About page draws all three: Archivo text, Zilla Slab headings and
  // the rune ᛗ beside the name.
  await page.goto("/about");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  const loaded = await page.evaluate(async () => {
    await document.fonts.ready;
    return Array.from(document.fonts)
      .filter((face) => face.status === "loaded")
      .map((face) => face.family.replace(/["']/g, ""));
  });
  expect(new Set(loaded)).toEqual(new Set(["Archivo", "Zilla Slab", "Noto Sans Runic"]));

  const fontFiles = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((name) => /\.woff2?(\?|$)/.test(name))
  );
  expect(fontFiles.length).toBeGreaterThan(0);
  for (const file of fontFiles) {
    expect(new URL(file).hostname).toBe(E2E.host);
  }
  expect(elsewhere, "font or stylesheet requests to another host").toEqual([]);
});
