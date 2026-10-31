// e2e/tests/already-exists.spec.ts
import { test, expect } from "../support/test";

// T163: a person created under a name one already carries stops at "already
// exists". Adding to it fills nothing it holds and keeps what differs in a
// note under it, written under the production rules; keeping the name on
// purpose makes a second one.

const addPerson = async (page: import("@playwright/test").Page, name: string, line: string) => {
  await page.goto("/npcs/create");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Who are they, in a line?").fill(line);
  await page.getByRole("button", { name: "Create & open" }).click();
};

test("a second person of one name is added to the first, or made on purpose", async ({ page }) => {
  await addPerson(page, "Wenna Gale", "Keeps the tide clock");
  await expect(page.getByRole("heading", { level: 1, name: "Wenna Gale" })).toBeVisible();
  const first = page.url();

  // The same name, in another case: asked, and told what adding would write.
  await addPerson(page, "wenna gale", "Sells eels at the quay");
  const dialog = page.getByRole("dialog", { name: "A Wenna Gale already exists" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("A note with what it says differently: description")).toBeVisible();

  await dialog.getByRole("button", { name: "Add to Wenna Gale" }).click();
  await expect(page).toHaveURL(first);
  await expect(page.getByRole("heading", { level: 1, name: "Wenna Gale" })).toBeVisible();
  // Its own line kept; the other one in a note under it.
  await expect(page.getByText("Keeps the tide clock")).toBeVisible();
  const notes = page.getByRole("region", { name: "Notes" });
  await expect(notes.getByText(/Sells eels at the quay/)).toBeVisible();

  await page.reload();
  await expect(page.getByRole("region", { name: "Notes" }).getByText(/Sells eels at the quay/)).toBeVisible();

  // Kept on purpose: a second Wenna Gale.
  await addPerson(page, "Wenna Gale", "Another one entirely");
  const again = page.getByRole("dialog", { name: "A Wenna Gale already exists" });
  await again.getByRole("button", { name: "Choose a name" }).click();
  await again.getByRole("button", { name: "Create Wenna Gale" }).click();
  await expect(page).toHaveURL(/\/npcs\/wenna-gale-2$/);
  await expect(page.getByText("Another one entirely")).toBeVisible();
});
