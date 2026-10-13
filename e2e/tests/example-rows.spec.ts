// e2e/tests/example-rows.spec.ts
import { test, expect } from "../support/test";

// T150: a signed-out visitor sees example rows under each list page's sign-in
// panel, so a stranger can see what the page holds. A member never does: a
// member's empty list keeps its own empty state.
//
// The example is hidden from assistive technology (the panel's sentence
// already says what the page is for), so it has no role to find it by; its
// chip and one example row per page are found by their text.

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
    test(`${path} shows example rows under the sign-in panel`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
      await expect(page.getByText("Example", { exact: true })).toBeVisible();
      await expect(page.getByText(row, { exact: true })).toBeVisible();
      // A picture, not rows: nothing in it is a control.
      await expect(page.getByRole("button", { name: new RegExp(row) })).toHaveCount(0);
    });
  }
});

test("a member's empty list keeps its own empty state, with no example", async ({ page }) => {
  // The seeded campaign has no rumours.
  await page.goto("/rumors");
  await expect(page.getByRole("heading", { name: "Muninn hasn't heard any rumours yet" })).toBeVisible();
  await expect(page.getByText("Example", { exact: true })).toHaveCount(0);
});
