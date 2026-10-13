// e2e/tests/example-rows.spec.ts
import { test, expect } from "../support/test";

// T150: a signed-out visitor sees each list page's example under a slim
// sign-in band, so a stranger can see what the page holds. A member never
// does: a member's empty list keeps its own empty state.
//
// The example is a region named "Example campaign"; one row per page is
// found inside it by its text.

const PAGES = [
  { path: "/npcs", heading: "Sign in to see who your party has met", row: "Odile Marrow" },
  { path: "/quests", heading: "Sign in to see your party's quests", row: "Recover the drowned ledger" },
  { path: "/locations", heading: "Sign in to see where your party has been", row: "Cinderford" },
  { path: "/rumors", heading: "Sign in to hear what the realm is saying", row: "The ferry crosses at night for those who never paid" },
  { path: "/story/chapters", heading: "Sign in to read your campaign's story", row: "Ashes on the Water" },
];

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const { path, heading, row } of PAGES) {
    test(`${path} shows its example under the sign-in band`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
      const example = page.getByRole("region", { name: "Example campaign" });
      await expect(example.getByText("Example", { exact: true })).toBeVisible();
      await expect(example.getByText(row, { exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "See what the site does" })).toHaveCount(0);
    });
  }
});

test("a member's empty list keeps its own empty state, with no example", async ({ page }) => {
  // The seeded campaign has no rumours.
  await page.goto("/rumors");
  await expect(page.getByRole("heading", { name: "Muninn hasn't heard any rumours yet" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Example campaign" })).toHaveCount(0);
});
