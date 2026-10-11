// e2e/tests/operator.spec.ts
import { createHash } from "crypto";
import { test, expect } from "../support/test";
import { E2E } from "../support/env";
import { FIXTURES } from "../support/seed";

// T137, step 3: the operator page, as the operator uses it, against the
// journeys' emulators. Its identity is signed in-process by `operator:dev`,
// so nothing here signs in.

test("the operator issues a founder link, sees it listed, and revokes it", async ({ page }) => {
  await page.goto("/founder-links");
  await page.getByLabel("Note (optional)").fill("Bree table");
  await page.getByRole("button", { name: "Issue a founder link" }).click();

  await expect(page.getByRole("heading", { name: "Founder link issued" })).toBeVisible();
  const link = (await page.getByText(/\/join\?founder=/).textContent())?.trim() ?? "";
  expect(link.startsWith(`${E2E.appUrl}/join?founder=`)).toBe(true);
  // A link is named by its invitation's id, the token's SHA-256 (T145), so
  // the ref says nothing about the token.
  const token = new URL(link).searchParams.get("founder")!;
  const ref = createHash("sha256").update(token, "utf8").digest("hex").slice(0, 6);
  expect(token.startsWith(ref)).toBe(false);

  await page.getByRole("link", { name: "Back to the founder links" }).click();
  const row = page.getByRole("listitem").filter({ hasText: "Bree table" });
  await expect(row).toContainText("Open");
  // The list never shows the link itself.
  await expect(page.getByText(link)).toHaveCount(0);

  await row.getByRole("button", { name: `Revoke ${ref}` }).click();
  await expect(page.getByRole("status")).toContainText(`Founder link ${ref} revoked.`);
  await expect(page.getByRole("listitem").filter({ hasText: "Bree table" })).toContainText("Revoked");
});

test("the operator raises a player's allowance, then puts them back on the defaults", async ({ page }) => {
  const { player } = FIXTURES;
  await page.goto("/accounts");
  await page.getByLabel("Email").fill(player.email);
  await page.getByRole("button", { name: "Look up" }).click();

  await expect(page.getByRole("heading", { name: player.email })).toBeVisible();
  await expect(page.getByText("None: the defaults apply")).toBeVisible();

  await page.getByLabel("Daily limit").fill("20");
  await page.getByLabel("Weekly limit").fill("60");
  await page.getByLabel("Monthly limit").fill("200");
  await page.getByRole("button", { name: "Set the allowance" }).click();

  await expect(page.getByRole("status")).toContainText("Allowance set.");
  await expect(page.getByText(/^20 \/ 60 \/ 200 a day, week and month, until /).first()).toBeVisible();

  await page.getByRole("button", { name: "Reset to the defaults" }).click();
  await expect(page.getByRole("status")).toContainText("Back on the defaults.");
  await expect(page.getByText("None: the defaults apply")).toBeVisible();
});

test("the operator page works at phone width", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/accounts?email=" + encodeURIComponent(FIXTURES.player.email));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const button = page.getByRole("button", { name: "Set the allowance" });
  expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
});
