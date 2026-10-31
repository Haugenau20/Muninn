// e2e/tests/record-notes.spec.ts
import { test, expect } from "../support/test";
import { FIXTURES } from "../support/seed";

// T133: a note is a document of its own under its record, shown oldest
// first and changed where it lives -- under the production rules, which cap a
// note on its own. The migration emptied the records' old arrays, and a note
// left in one is read by nothing.

const { notedNpc, quest } = FIXTURES;

test("a record's notes show together, each changed where it lives, and none from the old array", async ({ page }) => {
  await page.goto(`/npcs/${notedNpc.id}`);
  await expect(page.getByRole("heading", { level: 1, name: notedNpc.name })).toBeVisible();
  const notes = page.getByRole("region", { name: "Notes" });
  await expect(notes.getByText(notedNpc.note)).toBeVisible();
  await expect(notes.getByText(notedNpc.strayNote)).toHaveCount(0);

  await notes.getByLabel("Add a note").fill("Wants it back by the full moon");
  await notes.getByRole("button", { name: "Add note" }).click();
  await expect(notes.getByText("Wants it back by the full moon")).toBeVisible();
  await expect(notes.getByText("2 · oldest first")).toBeVisible();

  // The new note, in its own document: edited, then still there on reload.
  const today = new Date().toLocaleDateString("en-GB");
  await notes.getByRole("button", { name: `Edit the note from ${today}` }).click();
  await notes.getByLabel(`Note from ${today}`).fill("Wants it back by the new moon");
  await notes.getByRole("button", { name: "Save note" }).click();
  // The editor closes once the save has landed; going on sooner would race it.
  await expect(notes.getByRole("textbox", { name: `Note from ${today}` })).toHaveCount(0);
  await expect(notes.getByText("Wants it back by the new moon")).toBeVisible();

  // The older one, moved into its own document by the migration.
  await notes.getByRole("button", { name: "Edit the note from 20/09/2026" }).click();
  await notes.getByLabel("Note from 20/09/2026").fill("Sold us a leaky boat, twice");
  await notes.getByRole("button", { name: "Save note" }).click();
  await expect(notes.getByRole("textbox", { name: "Note from 20/09/2026" })).toHaveCount(0);
  await expect(notes.getByText("Sold us a leaky boat, twice")).toBeVisible();

  await page.reload();
  const reloaded = page.getByRole("region", { name: "Notes" });
  await expect(reloaded.getByText("Sold us a leaky boat, twice")).toBeVisible();
  await expect(reloaded.getByText("Wants it back by the new moon")).toBeVisible();

  // The list's open row reads them too, and not the stray one.
  await page.goto("/npcs");
  await page.getByRole("button", { name: `Expand ${notedNpc.name}` }).click();
  await expect(page.getByText("Sold us a leaky boat, twice")).toBeVisible();
  await expect(page.getByText("Wants it back by the new moon")).toBeVisible();
  await expect(page.getByText(notedNpc.strayNote)).toHaveCount(0);

  // Deleted from its document, it stays gone.
  await page.goto(`/npcs/${notedNpc.id}`);
  const again = page.getByRole("region", { name: "Notes" });
  await again.getByRole("button", { name: `Delete the note from ${today}` }).click();
  await page.getByRole("button", { name: "Delete note" }).click();
  await expect(again.getByText("Wants it back by the new moon")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("region", { name: "Notes" }).getByText("Sold us a leaky boat, twice")).toBeVisible();
  await expect(page.getByRole("region", { name: "Notes" }).getByText("Wants it back by the new moon")).toHaveCount(0);
});

// T163: a quest keeps notes as a person does, which the production rules
// allowed only for people, places and rumours before.
test("a quest takes a note, keeps it on reload, and lets it go", async ({ page }) => {
  await page.goto(`/quests/${quest.id}`);
  await expect(page.getByRole("heading", { level: 1, name: quest.title })).toBeVisible();
  const notes = page.getByRole("region", { name: "Notes" });

  await notes.getByLabel("Add a note").fill("The keeper's lamp was still warm");
  await notes.getByRole("button", { name: "Add note" }).click();
  await expect(notes.getByText("The keeper's lamp was still warm")).toBeVisible();

  await page.reload();
  const reloaded = page.getByRole("region", { name: "Notes" });
  await expect(reloaded.getByText("The keeper's lamp was still warm")).toBeVisible();

  const today = new Date().toLocaleDateString("en-GB");
  await reloaded.getByRole("button", { name: `Delete the note from ${today}` }).click();
  await page.getByRole("button", { name: "Delete note" }).click();
  await expect(reloaded.getByText("The keeper's lamp was still warm")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: quest.title })).toBeVisible();
  await expect(page.getByRole("region", { name: "Notes" }).getByText("The keeper's lamp was still warm")).toHaveCount(0);
});
