// e2e/tests/resend-link.spec.ts
import { test, expect } from "../support/test";
import { FIXTURES } from "../support/seed";
import { nextSignInLink, signInLinksFor } from "../support/outbox";

// Somebody whose email has not arrived, so they start signed out.
test.use({ storageState: { cookies: [], origins: [] } });

// T151: the "Check your inbox" screen offered only "use a different email",
// so sending the same link again was labelled as something else. The resend
// is a control of its own now, held back for a minute, and its link works.
test("a player whose email never came sends it again, and signs in with the new one", async ({ page }) => {
  const { player, campaign } = FIXTURES;
  // The page's clock, so the minute's wait passes at once. It runs on by
  // itself otherwise, so Firebase's own timers are untouched.
  await page.clock.install();

  await page.goto("/signin");
  await page.getByLabel("Email").fill(player.email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByText("Check your inbox")).toBeVisible();

  const resend = page.getByRole("button", { name: "send it again" });
  await expect(resend).toBeDisabled();
  await expect(page.getByText(/send it again in 1 min/)).toBeVisible();

  const before = new Set((await signInLinksFor(player.email)).map((c) => c.oobCode));
  await page.clock.fastForward("01:01");
  await expect(resend).toBeEnabled();
  await resend.click();

  await expect(page.getByRole("status").filter({ hasText: "Sent again." })).toContainText(
    "code from the newest email"
  );
  await expect(resend).toBeDisabled();
  await expect(page.getByText(/send it again in 2 min/)).toBeVisible();

  const link = await nextSignInLink(player.email, before);
  await page.goto(link.oobLink);
  await expect(page.getByRole("heading", { level: 1, name: campaign.name })).toBeVisible();
});
