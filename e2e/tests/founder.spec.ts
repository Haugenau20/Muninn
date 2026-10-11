// e2e/tests/founder.spec.ts
import type { Browser, Page } from "@playwright/test";
import { test, expect } from "../support/test";
import { FIXTURES } from "../support/seed";
import { E2E } from "../support/env";
import { nextSignInLink, signInLinksFor } from "../support/outbox";

// Two people who have never used the site, so neither starts signed in.
test.use({ storageState: { cookies: [], origins: [] } });

const FOUNDER = { email: "rowan@e2e.test", name: "Rowan" };
const PLAYER = { email: "tamsin@e2e.test", name: "Tamsin" };
const GROUP = "The Thursday Table";
const CAMPAIGN = "The Salt Road";

/**
 * Open a sign-in link the app asked the Auth emulator to send `email`, after
 * `send` asked for it.
 */
async function openSignInLink(page: Page, email: string, send: () => Promise<void>): Promise<void> {
  const before = new Set((await signInLinksFor(email)).map((c) => c.oobCode));
  await send();
  await expect(page.getByText("Check your inbox")).toBeVisible();
  const link = await nextSignInLink(email, before);
  await page.goto(link.oobLink);
}

/**
 * A second browser, signed out, under the fixture's two rules: nothing leaves
 * the machine, and its uncaught errors are collected for the journey to check.
 */
async function freshPage(browser: Browser, errors: string[]): Promise<Page> {
  const context = await browser.newContext();
  await context.route((url) => url.hostname !== E2E.host, (route) => route.abort());
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  return page;
}

// T127, the onboarding plan's step 3: a founder link leads, without the
// maintainer, from the link to a group with a campaign and a second player.
test("a founder starts a group from a founder link, and a player joins it", async ({ page, browser }) => {
  // Two sign-ups, each through the sign-up gate's blocking function, and
  // five callables: in a full run against cold emulators it outlasts the
  // default 30 seconds, so it gets three times that.
  test.slow();
  // The link, opened by someone with no account.
  await page.goto(`/join?founder=${FIXTURES.founderLink.token}`);
  await expect(page.getByRole("heading", { name: "First, your account" })).toBeVisible();

  await page.getByLabel("Email").fill(FOUNDER.email);
  await openSignInLink(page, FOUNDER.email, () =>
    page.getByRole("button", { name: "Email me a sign-in link" }).click()
  );

  // Signing in brings them back to the link, to name the group. Creating the
  // account runs the sign-up gate (a blocking function), which in the
  // emulator takes a few seconds on its first call.
  await expect(page.getByRole("heading", { name: "Name your group" })).toBeVisible({ timeout: 15_000 });
  await page.getByLabel("Group name").fill(GROUP);
  await page.getByLabel("Your name in this group").fill(FOUNDER.name);
  await page.getByRole("button", { name: "Create the group" }).click();

  await expect(page.getByRole("heading", { name: "Start your first campaign" })).toBeVisible();
  await page.getByLabel("Campaign name").fill(CAMPAIGN);
  await page.getByRole("button", { name: "Create campaign" }).click();

  // Then the players: the page with the invite button.
  await expect(page).toHaveURL(/\/admin\/people$/);
  await expect(page.getByRole("heading", { name: GROUP })).toBeVisible();
  await page.getByRole("button", { name: "Invite someone" }).click();
  const invite = await page.getByRole("dialog").getByText(/\/join\?token=/).textContent();
  expect(invite).toBeTruthy();

  // Copied again from the pending list, it is the same link: the invitation
  // is stored under its token's hash, and the server reveals the token (T145).
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  // The analytics question sits over the list until it is answered.
  await page.getByRole("region", { name: "Privacy" }).getByRole("button", { name: "No thanks" }).click();
  await page.getByRole("region", { name: "Pending invitations" }).getByRole("button", { name: "Copy link" }).click();
  await expect(page.getByRole("dialog").getByText(/\/join\?token=/)).toHaveText(invite!);
  await page.keyboard.press("Escape");

  // The link is spent: opened again, it is refused.
  await page.goto(`/join?founder=${FIXTURES.founderLink.token}`);
  await page.getByLabel("Group name").fill("A second table");
  await page.getByLabel("Your name in this group").fill(FOUNDER.name);
  await page.getByRole("button", { name: "Create the group" }).click();
  await expect(page.getByRole("alert")).toContainText("already been used");

  // A player follows the invitation, in a browser of their own.
  const playerErrors: string[] = [];
  const player = await freshPage(browser, playerErrors);
  await player.goto(invite!.trim());
  await player.getByLabel("Your name in this group").fill(PLAYER.name);
  await player.getByLabel("Email").fill(PLAYER.email);
  await expect(player.getByText("That name is free")).toBeVisible();
  await openSignInLink(player, PLAYER.email, () =>
    player.getByRole("button", { name: "Email me a link to join" }).click()
  );

  // They land in the founder's campaign.
  await expect(player.getByRole("heading", { level: 1, name: CAMPAIGN })).toBeVisible({ timeout: 15_000 });
  await player.context().close();
  expect(playerErrors, "uncaught errors in the player's page").toEqual([]);
});
