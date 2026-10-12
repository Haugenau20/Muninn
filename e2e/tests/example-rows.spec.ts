// e2e/tests/example-rows.spec.ts
import { test, expect } from "../support/test";

// T150: a list the campaign has nothing in shows example rows under its empty
// state, and loses them with its first record. The seeded campaign has no
// rumours, so the rumour list is the one this journey can empty and fill.
//
// The example is hidden from assistive technology (the empty state's sentence
// already says what the page is for), so it has no role to find it by; its
// chip and one example rumour are found by their text.

const EXAMPLE_RUMOUR = "The ferry crosses at night for those who never paid";
// Short enough that the row names it in full rather than by a shortened title.
const RUMOUR = "The harbourmaster is in debt";

test("an empty list shows example rows until the party records its first", async ({ page }) => {
  await page.goto("/rumors");
  await expect(page.getByRole("heading", { name: "Muninn hasn't heard any rumours yet" })).toBeVisible();
  await expect(page.getByText("Example", { exact: true })).toBeVisible();
  await expect(page.getByText(EXAMPLE_RUMOUR)).toBeVisible();
  // A picture, not rows: nothing in it is a control.
  await expect(page.getByRole("button", { name: new RegExp(EXAMPLE_RUMOUR) })).toHaveCount(0);

  await page.getByLabel("Heard something? Write it down here").fill(RUMOUR);
  await page.keyboard.press("Enter");
  const row = page.getByRole("button", { name: new RegExp(`^(Expand|Collapse) ${RUMOUR}$`) });
  await expect(row).toBeVisible();
  await expect(page.getByText("Example", { exact: true })).toHaveCount(0);
  await expect(page.getByText(EXAMPLE_RUMOUR)).toHaveCount(0);

  // Deleted again, so the journeys after this one see the campaign as seeded,
  // and the example comes back with the empty list.
  if ((await row.getAttribute("aria-expanded")) !== "true") await row.click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: `Delete ${RUMOUR}` }).click();
  await expect(page.getByRole("heading", { name: "Muninn hasn't heard any rumours yet" })).toBeVisible();
  await expect(page.getByText(EXAMPLE_RUMOUR)).toBeVisible();
});
