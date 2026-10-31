// e2e/tests/private-records.spec.ts
import { test, expect } from "../support/test";
import { E2E } from "../support/env";
import { FIXTURES } from "../support/seed";

// T163: a person, or a rumour, kept to the player who met them until they
// publish it. Written under the production rules into the player's own
// space, never into the campaign, and marked wherever it is shown.

const { player, group, campaign } = FIXTURES;

/** Whether a document exists, read as the emulator's owner: past the rules. */
async function stored(path: string): Promise<boolean> {
  const response = await fetch(
    `${E2E.firestoreUrl}/v1/projects/${E2E.projectId}/databases/(default)/documents/${path}`,
    { headers: { Authorization: "Bearer owner" } }
  );
  return response.ok;
}

test("a private person is the player's alone: in their space, marked, with notes", async ({ page }) => {
  await page.goto("/npcs/create");
  await page.getByRole("checkbox", { name: /private/i }).check();
  await page.getByLabel("Name", { exact: true }).fill("Ysolde Vane");
  await page.getByLabel("Who are they, in a line?").fill("Met the DM alone at the lighthouse");
  await page.getByRole("button", { name: "Create & open" }).click();

  await expect(page).toHaveURL(/\/npcs\/ysolde-vane$/);
  await expect(page.getByRole("heading", { level: 1, name: "Ysolde Vane" })).toBeVisible();
  await expect(page.getByText("Only you see this until you publish it.")).toBeVisible();

  expect(await stored(`groups/${group.id}/users/${player.uid}/private/${campaign.id}/npcs/ysolde-vane`)).toBe(true);
  expect(await stored(`groups/${group.id}/campaigns/${campaign.id}/npcs/ysolde-vane`)).toBe(false);

  // Its notes live beside it, under the private-space rules.
  const notes = page.getByRole("region", { name: "Notes" });
  await notes.getByLabel("Add a note").fill("Knows where the keeper went");
  await notes.getByRole("button", { name: "Add note" }).click();
  await expect(notes.getByText("Knows where the keeper went")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("region", { name: "Notes" }).getByText("Knows where the keeper went")).toBeVisible();

  // Beside the campaign's people, marked.
  await page.goto("/npcs");
  const row = page.getByRole("button", { name: "Expand Ysolde Vane" });
  await expect(row).toBeVisible();
  await expect(row.getByText("Private")).toBeVisible();
});

test("a rumour from the composer can be kept private", async ({ page }) => {
  await page.goto("/rumors");
  await page.getByRole("checkbox", { name: /private/i }).check();
  await page.getByLabel("Heard something? Write it down here").fill("The keeper owes Ysolde money");
  await page.getByRole("button", { name: "Add rumour" }).click();

  const row = page.getByRole("button", { name: /The keeper owes Ysolde money/ }).first();
  await expect(row).toBeVisible();
  await expect(row.getByText("Private")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: /The keeper owes Ysolde money/ }).first().getByText("Private")).toBeVisible();
});
