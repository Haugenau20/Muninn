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
  { path: "/locations", heading: "Sign in to see where your party has been", row: "Harrowgate" },
  { path: "/rumors", heading: "Sign in to hear what the realm is saying", row: "The ferry crosses at night for those who never paid" },
  { path: "/story/chapters", heading: "Sign in to read your campaign's story", row: "Into the Fen" },
  { path: "/notes", heading: "Sign in to read your notes", row: "Gully Thrane" },
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

  // The example is the page itself, working: it filters, opens rows, and
  // goes nowhere when a row's way out is pressed.
  test("the NPC example filters, opens a row, and stays put on More info", async ({ page }) => {
    await page.goto("/npcs");
    const example = page.getByRole("region", { name: "Example campaign" });
    await expect(example.getByRole("button", { name: "Collapse Vesk Harrow" })).toBeVisible();

    await example.getByRole("group", { name: "Filter by relationship" }).getByRole("button", { name: "Friendly" }).click();
    await expect(example.getByRole("button", { name: "Expand Odile Marrow" })).toBeVisible();
    await expect(example.getByRole("button", { name: /Vesk Harrow/ })).toHaveCount(0);

    await example.getByRole("button", { name: "Expand Odile Marrow" }).click();
    await example.getByRole("button", { name: "More info" }).click();
    await expect(page).toHaveURL(/\/npcs$/);
    await expect(example.getByRole("button", { name: "Select NPCs" })).toHaveCount(0);
  });

  test("the location example flattens the tree while searching", async ({ page }) => {
    await page.goto("/locations");
    const example = page.getByRole("region", { name: "Example campaign" });
    await example.getByPlaceholder("Search locations...").fill("archive");
    await expect(example.getByText(/Searching flattens the tree/)).toBeVisible();
    await expect(example.getByRole("button", { name: "Expand The Drowned Archive" })).toBeVisible();
  });

  test("the quest example opens on a quest's objectives, history folded", async ({ page }) => {
    await page.goto("/quests");
    const example = page.getByRole("region", { name: "Example campaign" });
    await expect(example.getByText("Search under the ferry landing")).toBeVisible();
    await expect(example.getByRole("button", { name: /Cross at Cinderford after dark/ })).toHaveCount(0);
    await example.getByRole("button", { name: /Completed Quests/ }).click();
    await expect(example.getByRole("button", { name: "Expand Cross at Cinderford after dark" })).toBeVisible();
  });

  // Home is the way into the examples: a recent row opens its own row there.
  test("Home's recent NPC opens that person's row on the NPC example", async ({ page }) => {
    await page.goto("/");
    // The analytics question sits over the panel until it is answered.
    await page.getByRole("region", { name: "Privacy" }).getByRole("button", { name: "No thanks" }).click();
    const panel = page.getByTestId("example-panel");
    await expect(panel.getByRole("link", { name: /14\s*Chapters/i })).toHaveAttribute("href", "/story/chapters");
    await panel.getByRole("link", { name: /Odile Marrow/ }).click();
    await expect(page).toHaveURL(/\/npcs\?highlight=example-npc-odile$/);
    const example = page.getByRole("region", { name: "Example campaign" });
    await expect(example.getByRole("button", { name: "Collapse Odile Marrow" })).toBeVisible();
    await expect(example.getByText(/Takes payment in salt/)).toBeVisible();
  });

  // Home's recent rows keep their detail to one line; at phone width that
  // line must shorten, not push the page wider than the phone.
  test("signed-out Home fits a phone's width", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto("/");
    await expect(page.getByTestId("example-panel")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("the notes example is a scanned note that can be read and not changed", async ({ page }) => {
    await page.goto("/notes");
    const example = page.getByRole("region", { name: "Example campaign" });
    await expect(example.getByRole("textbox", { name: "Note title" })).toHaveValue("Session 13 — Into the Fen");
    await expect(example.getByText("IN YOUR CAMPAIGN · 9")).toBeVisible();
    await expect(example.getByRole("textbox", { name: "Note content" })).not.toBeEditable();
    await example.getByRole("button", { name: "Scan note" }).click();
    await expect(example.getByText("DETECTED, NOT IN YOUR CAMPAIGN · 5")).toBeVisible();
    await expect(page).toHaveURL(/\/notes$/);
  });

  test("the rumour example opens a rumour as text, with nothing to edit", async ({ page }) => {
    await page.goto("/rumors");
    const example = page.getByRole("region", { name: "Example campaign" });
    await expect(example.getByText(/We crossed, so it does/)).toBeVisible();
    await expect(example.getByRole("textbox")).toHaveCount(1);
    await expect(example.getByLabel("Heard something? Write it down here")).toHaveCount(0);
    await example.getByRole("button", { name: "Open the quest" }).click();
    await expect(page).toHaveURL(/\/rumors$/);
  });
});

test("a member's empty list keeps its own empty state, with no example", async ({ page }) => {
  // The seeded campaign has no rumours.
  await page.goto("/rumors");
  await expect(page.getByRole("heading", { name: "Muninn hasn't heard any rumours yet" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Example campaign" })).toHaveCount(0);
});
